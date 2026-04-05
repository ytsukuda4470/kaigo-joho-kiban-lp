'use strict';

const { onCall, HttpsError, onRequest } = require('firebase-functions/v2/https');
const { onSchedule }         = require('firebase-functions/v2/scheduler');
const { defineSecret }       = require('firebase-functions/params');
const { initializeApp }      = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const fetch      = require('node-fetch');
const cheerio    = require('cheerio');

initializeApp();
const db = getFirestore();

const REGION         = 'asia-northeast1';
const GITHUB_OWNER   = 'ytsukuda4470';
const GITHUB_REPO    = 'kaigo-joho-kiban-lp';
const KEYWORD        = '介護情報基盤';

// GAS ウェブアプリ URL（メール送信・フォーム受付）
const GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbzToDsIwWSOFTV9zNuFawFZIk2SFczuritdL8Ouu1APhuHDEKFfb-ULFvV33lwsXuiVUQ/exec';

// ── シークレット定義 ──────────────────────────────────────
// firebase functions:secrets:set GCHAT_WEBHOOK_URL
// firebase functions:secrets:set GITHUB_TOKEN
// firebase functions:secrets:set GAS_SECRET
const GCHAT_WEBHOOK_URL = defineSecret('GCHAT_WEBHOOK_URL');
const GITHUB_TOKEN      = defineSecret('GITHUB_TOKEN');
const GAS_SECRET        = defineSecret('GAS_SECRET');

// ── ユーティリティ ────────────────────────────────────────

function requireAuth(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
}

// ── メール送信 ────────────────────────────────────────────
// GAS ウェブアプリ（GmailApp）経由でメールを送信します。
// GMAIL_USER / GMAIL_APP_PASSWORD は不要になりました。

exports.sendEmail = onCall(
  { region: REGION, secrets: [GAS_SECRET] },
  async (request) => {
    requireAuth(request);
    const { to, subject, body, inquiryId } = request.data;
    if (!to || !subject) throw new HttpsError('invalid-argument', '宛先と件名は必須です');

    const res = await fetch(GAS_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sendEmail',
        secret: GAS_SECRET.value(),
        to, subject, body: body || '',
      }),
    });
    if (!res.ok) throw new HttpsError('internal', `GAS endpoint error: ${res.status}`);
    const result = await res.json().catch(() => ({}));
    if (result.success === false) throw new HttpsError('internal', result.error || 'メール送信に失敗しました');

    // 対応記録に保存
    if (inquiryId) {
      await db.collection('actions').add({
        inquiryId,
        type:      'メール送信',
        content:   `To: ${to}\n件名: ${subject}\n\n${body||''}`,
        staff:     request.auth.token.email || '',
        createdAt: FieldValue.serverTimestamp(),
      });
      await db.collection('inquiries').doc(inquiryId).update({
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return { success: true };
  }
);

function fmtDate(d) {
  if (!d) return '';
  const dt = d.toDate ? d.toDate() : new Date(d);
  return `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
}

// ── Google Chat 通知 ──────────────────────────────────────

exports.notifyGoogleChat = onCall(
  { region: REGION, secrets: [GCHAT_WEBHOOK_URL] },
  async (request) => {
    requireAuth(request);
    const { message } = request.data;
    const url = GCHAT_WEBHOOK_URL.value();
    if (!url) throw new HttpsError('failed-precondition', 'GCHAT_WEBHOOK_URL が未設定です');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });
    return { success: res.ok, status: res.status };
  }
);

// ── GitHub API ヘルパー ───────────────────────────────────

async function githubReq(path, method = 'GET', body = null) {
  const token = GITHUB_TOKEN.value();
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/${path}`, opts);
  return res;
}

// ── LP ニュース取得 ───────────────────────────────────────

exports.getLPNewsItems = onCall(
  { region: REGION, secrets: [GITHUB_TOKEN] },
  async (request) => {
    requireAuth(request);
    const res = await githubReq('contents/index.html');
    if (!res.ok) throw new HttpsError('internal', 'GitHub からファイルを取得できませんでした');
    const data = await res.json();
    const html = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');

    const blockMatch = html.match(/<!-- NEWS_ITEMS_START -->([\s\S]*?)<!-- NEWS_ITEMS_END -->/);
    if (!blockMatch) return { items: [], sha: data.sha };

    const items = [];
    const aRe = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = aRe.exec(blockMatch[1])) !== null) {
      const inner = m[2];
      const dateM  = inner.match(/text-gray-400[^>]*>([^<]+)<\/span>/);
      const srcM   = inner.match(/text-primary[^>]*>([^<]+)<\/span>/);
      const titleM = inner.match(/<p[^>]*>\s*([\s\S]*?)\s*<\/p>/);
      items.push({
        url:    m[1],
        date:   dateM  ? dateM[1].trim()  : '',
        source: srcM   ? srcM[1].trim()   : '',
        title:  titleM ? titleM[1].trim().replace(/\s+/g, ' ') : '',
      });
    }
    return { items, sha: data.sha };
  }
);

// ── LP ニュース保存 ───────────────────────────────────────

function articleHtml(art) {
  const title = art.title.length > 60 ? art.title.slice(0, 60) + '…' : art.title;
  return [
    `                <a href="${art.url}" target="_blank" rel="noopener noreferrer"`,
    `                   class="reveal flex gap-4 bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow border border-gray-100 group">`,
    `                    <div class="flex-shrink-0 text-center">`,
    `                        <span class="block text-xs text-gray-400">${art.date}</span>`,
    `                        <span class="block text-xs font-bold text-primary">${art.source}</span>`,
    `                    </div>`,
    `                    <div class="flex-1 min-w-0">`,
    `                        <p class="text-sm font-medium text-gray-800 group-hover:text-primary transition-colors line-clamp-2">`,
    `                            ${title}`,
    `                        </p>`,
    `                        <span class="mt-1 inline-flex items-center text-xs text-primary/70">`,
    `                            <i class="fas fa-external-link-alt mr-1 text-xs"></i>記事を読む`,
    `                        </span>`,
    `                    </div>`,
    `                </a>`,
  ].join('\n');
}

exports.saveLPNewsItems = onCall(
  { region: REGION, secrets: [GITHUB_TOKEN] },
  async (request) => {
    requireAuth(request);
    const { items } = request.data;

    const fileRes = await githubReq('contents/index.html');
    if (!fileRes.ok) throw new HttpsError('internal', 'GitHub ファイル取得失敗');
    const fileData = await fileRes.json();
    const html = Buffer.from(fileData.content.replace(/\n/g, ''), 'base64').toString('utf-8');

    const newBlock =
      '                <!-- NEWS_ITEMS_START -->\n' +
      items.map(articleHtml).join('\n') +
      '\n                <!-- NEWS_ITEMS_END -->';
    const newHtml = html.replace(
      /<!-- NEWS_ITEMS_START -->[\s\S]*?<!-- NEWS_ITEMS_END -->/,
      newBlock
    );

    const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const putRes = await githubReq('contents/index.html', 'PUT', {
      message: `LP ニュース手動更新 ${now}`,
      content: Buffer.from(newHtml, 'utf-8').toString('base64'),
      sha: fileData.sha,
    });
    if (!putRes.ok) {
      const err = await putRes.text();
      throw new HttpsError('internal', `GitHub commit 失敗: ${err}`);
    }
    return { success: true };
  }
);

// ── GitHub Actions トリガー ───────────────────────────────

exports.triggerNewsUpdate = onCall(
  { region: REGION, secrets: [GITHUB_TOKEN] },
  async (request) => {
    requireAuth(request);
    const res = await githubReq(
      'actions/workflows/update-news.yml/dispatches',
      'POST',
      { ref: 'main', inputs: { force_notify: 'true' } }
    );
    return { success: res.status === 204, status: res.status };
  }
);

// ── LP 改訂履歴 ───────────────────────────────────────────

exports.getLPHistory = onCall(
  { region: REGION, secrets: [GITHUB_TOKEN] },
  async (request) => {
    requireAuth(request);
    const res = await githubReq('commits?path=index.html&per_page=30');
    if (!res.ok) return { commits: [] };
    const data = await res.json();
    const commits = data.map(c => ({
      sha:     c.sha.slice(0, 7),
      message: c.commit.message.split('\n')[0],
      author:  c.commit.author.name,
      date:    fmtDate(c.commit.author.date),
      url:     c.html_url,
    }));
    return { commits };
  }
);

exports.getWorkflowStatus = onCall(
  { region: REGION, secrets: [GITHUB_TOKEN] },
  async (request) => {
    requireAuth(request);
    const res = await githubReq('actions/workflows/update-news.yml/runs?per_page=1');
    if (!res.ok) return { run: null };
    const data = await res.json();
    const run = data.workflow_runs?.[0];
    if (!run) return { run: null };
    return {
      run: {
        status:     run.status,
        conclusion: run.conclusion,
        createdAt:  fmtDate(run.created_at),
        url:        run.html_url,
      }
    };
  }
);

// ── ニュース自動収集（Cloud Scheduler 毎日 8:00 JST） ────────

// キーワードフィルタ（OR条件）
const NEWS_KEYWORDS = ['介護情報基盤', '介護DX', '科学的介護', 'LIFE', '電子申請', 'ケアプラン'];

/**
 * 日付文字列を "YYYY/MM" 形式に正規化する。
 * datetime属性（ISO形式）、日本語表記（年/月）、ドット区切り（YYYY.MM.DD）に対応。
 */
function normalizeDate(raw) {
  if (!raw) return '';
  // ISO形式: 2025-12-01T... または 2025-12-01
  const isoMatch = raw.match(/^(\d{4})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}/${isoMatch[2]}`;
  // 日本語・スラッシュ: 2025年12月 / 2025/12/01
  const jaMatch = raw.match(/(\d{4})[年/](\d{1,2})/);
  if (jaMatch) return `${jaMatch[1]}/${String(jaMatch[2]).padStart(2, '0')}`;
  // ドット区切り: 2025.12.01
  const dotMatch = raw.match(/(\d{4})\.(\d{1,2})/);
  if (dotMatch) return `${dotMatch[1]}/${String(dotMatch[2]).padStart(2, '0')}`;
  return '';
}

/**
 * タイトルがキーワード一覧のいずれかを含むか判定する。
 */
function matchesKeyword(title) {
  return NEWS_KEYWORDS.some(kw => title.includes(kw));
}

/**
 * サイト別スクレイピング設定。
 * selectors: 記事コンテナ → タイトル → リンク → 日付 の順で試みるセレクタリスト。
 */
const SITE_SELECTORS = {
  Joint: {
    containers: [
      'article.post',
      'article',
      '.post-list .post-item',
      '.search-entry',
      '.entry',
    ],
    titles: [
      '.entry-title a',
      '.entry-title',
      'h2.post-title a',
      'h2.post-title',
      'h2 a',
      'h3 a',
    ],
    dates: [
      'time[datetime]',
      'time',
      '.entry-date',
      '.post-date',
      '.published',
      '.date',
    ],
  },
  GemMed: {
    containers: [
      'article',
      '.post',
      '.article-list li',
      '.entry',
      'li.item',
    ],
    titles: [
      '.entry-title a',
      '.entry-title',
      'h2 a',
      'h3 a',
      '.post-title a',
      '.article-title a',
    ],
    dates: [
      'time[datetime]',
      'time',
      '.entry-date',
      '.post-date',
      '.date',
      '.published',
    ],
  },
  介護経営: {
    // kaigokeiei.com: 日付は "2026.02.26" 形式のspanまたはp
    containers: [
      'article',
      '.post',
      '.entry',
      'li.item',
      '.news-item',
    ],
    titles: [
      '.entry-title a',
      '.entry-title',
      'h2 a',
      'h3 a',
      '.post-title a',
      'a.title',
    ],
    dates: [
      'time[datetime]',
      'time',
      '.entry-date',
      '.date',
      '.post-date',
      'span.date',
      'p.date',
    ],
  },
};

/**
 * cheerio で記事コンテナを特定し、タイトル・URL・日付を抽出する。
 * セレクタを順番に試し、最初に記事が見つかったものを使用する。
 * 記事が見つからない場合はフォールバックセレクタを使用する。
 */
function scrapeArticles($, srcName, srcUrl, limit) {
  const cfg = SITE_SELECTORS[srcName] || {};
  const containerSelectors = cfg.containers || ['article', '.post', '.article-item'];
  const titleSelectors     = cfg.titles    || ['h2 a', 'h3 a', '.entry-title a', '.entry-title'];
  const dateSelectors      = cfg.dates     || ['time[datetime]', 'time', '.date', '.published'];

  let $containers = $([]);
  for (const sel of containerSelectors) {
    const found = $(sel);
    if (found.length > 0) {
      $containers = found;
      console.log(`[${srcName}] container selector: "${sel}" (${found.length}件)`);
      break;
    }
  }
  // フォールバック: 汎用セレクタ
  if ($containers.length === 0) {
    $containers = $('article, .post, li.item');
    console.log(`[${srcName}] fallback container: article/.post/li.item (${$containers.length}件)`);
  }

  const results = [];
  const hostname = new URL(srcUrl).hostname;

  $containers.slice(0, limit * 3).each((_, el) => {
    // タイトル・URL の取得
    let title = '';
    let href  = '';
    for (const sel of titleSelectors) {
      const $el = $(el).find(sel).first();
      if ($el.length) {
        title = $el.text().trim();
        href  = $el.attr('href') || $(el).find('a').first().attr('href') || '';
        break;
      }
    }
    // タイトルが取れない場合は最初のaタグから取得（フォールバック）
    if (!title) {
      const $a = $(el).find('a').first();
      title = $a.text().trim();
      href  = $a.attr('href') || '';
    }

    // 日付の取得（datetime属性を優先）
    let dateRaw = '';
    for (const sel of dateSelectors) {
      const $d = $(el).find(sel).first();
      if ($d.length) {
        dateRaw = $d.attr('datetime') || $d.text().trim();
        if (dateRaw) break;
      }
    }

    if (!title || !href) return;
    if (!matchesKeyword(title)) return;

    const url = href.startsWith('http') ? href : `https://${hostname}${href}`;
    results.push({
      date:   normalizeDate(dateRaw),
      source: srcName,
      title,
      url,
    });
  });

  return results.slice(0, limit);
}

exports.scheduledNewsUpdate = onSchedule(
  {
    schedule: 'every day 08:00',
    timeZone: 'Asia/Tokyo',
    region: REGION,
    secrets: [GITHUB_TOKEN, GCHAT_WEBHOOK_URL],
  },
  async () => {
    console.log('[ニュース自動収集] 開始');
    const ARTICLE_LIMIT = 12; // 固定URL除いた取得上限
    const sources = [
      { name: 'Joint',    url: `https://www.joint-kaigo.com/?s=${encodeURIComponent(KEYWORD)}` },
      { name: 'GemMed',   url: `https://gemmed.ghc-j.com/?s=${encodeURIComponent(KEYWORD)}` },
      { name: '介護経営', url: `https://kaigokeiei.com/?s=${encodeURIComponent(KEYWORD)}` },
    ];

    const articles = [];
    for (const src of sources) {
      try {
        const res = await fetch(src.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ja,en;q=0.5',
          },
          timeout: 15000,
        });
        if (!res.ok) {
          console.warn(`[${src.name}] HTTP ${res.status}`);
          continue;
        }
        const html = await res.text();
        const $ = cheerio.load(html);
        const found = scrapeArticles($, src.name, src.url, ARTICLE_LIMIT);
        console.log(`[${src.name}] ${found.length}件取得`);
        articles.push(...found);
      } catch (e) {
        console.warn(`[${src.name}] scrape failed:`, e.message);
      }
    }

    // 厚生労働省は固定
    const fixed = [{
      date: '2026/02', source: '厚生労働省',
      title: '介護情報基盤について（厚生労働省 公式ページ）',
      url: 'https://www.mhlw.go.jp/stf/newpage_59231.html',
    }];

    // 重複除去（URL基準）・先頭から最大 ARTICLE_LIMIT+1 件
    const seen = new Set();
    const unique = [...fixed, ...articles].filter(a => {
      if (seen.has(a.url)) return false;
      seen.add(a.url); return true;
    }).slice(0, ARTICLE_LIMIT + 1);

    // Firestore に保存（LP管理・CRMで参照）
    await db.doc('config/news').set({ items: unique, updatedAt: FieldValue.serverTimestamp() });
    console.log(`[ニュース自動収集] ${unique.length}件をFirestoreに保存`);

    // Google Chat 通知
    const webhook = GCHAT_WEBHOOK_URL.value();
    if (webhook) {
      const lines = unique.slice(0, 5).map(a => `• [${a.source}] ${a.date} — ${a.title.slice(0, 40)}`);
      const msg = `*ニュース自動更新*\n件数: ${unique.length}件\n\n${lines.join('\n')}`;
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: msg }),
      });
    }
  }
);
