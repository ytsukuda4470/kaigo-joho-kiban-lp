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

// ── シークレット定義 ──────────────────────────────────────
// firebase functions:secrets:set GCHAT_WEBHOOK_URL
// firebase functions:secrets:set GITHUB_TOKEN
// firebase functions:secrets:set GAS_EMAIL_URL   (GAS ウェブアプリの URL)
// firebase functions:secrets:set GAS_SECRET      (GAS スクリプトプロパティ GAS_SECRET と同じ値)
const GCHAT_WEBHOOK_URL = defineSecret('GCHAT_WEBHOOK_URL');
const GITHUB_TOKEN      = defineSecret('GITHUB_TOKEN');
const GAS_EMAIL_URL     = defineSecret('GAS_EMAIL_URL');
const GAS_SECRET        = defineSecret('GAS_SECRET');

// ── ユーティリティ ────────────────────────────────────────

function requireAuth(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
}

// ── メール送信（GAS 経由） ────────────────────────────────
// メール送信は Google Apps Script の GmailApp に委譲します。
// GAS_EMAIL_URL: GAS ウェブアプリの URL
// GAS_SECRET:    GAS スクリプトプロパティ「GAS_SECRET」と同じ値

exports.sendEmail = onCall(
  { region: REGION, secrets: [GAS_EMAIL_URL, GAS_SECRET] },
  async (request) => {
    requireAuth(request);
    const { to, subject, body, inquiryId } = request.data;
    if (!to || !subject) throw new HttpsError('invalid-argument', '宛先と件名は必須です');

    const gasUrl = GAS_EMAIL_URL.value();
    if (!gasUrl) throw new HttpsError('failed-precondition', 'GAS_EMAIL_URL が未設定です');

    // GAS ウェブアプリへ POST
    const res = await fetch(gasUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:     'sendEmail',
        secret:     GAS_SECRET.value(),
        to,
        subject,
        body:       body || '',
        senderName: '株式会社２７９',
      }),
      redirect: 'follow',   // GAS は 302 リダイレクトを返す
    });

    const result = await res.json().catch(() => ({}));
    if (!result.success) {
      throw new HttpsError('internal', result.error || 'GAS メール送信に失敗しました');
    }

    // Firestore に対応記録を保存
    if (inquiryId) {
      await db.collection('actions').add({
        inquiryId,
        type:      'メール送信',
        content:   `To: ${to}\n件名: ${subject}\n\n${body || ''}`,
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

// ── ニュース自動収集（Cloud Scheduler 毎週月曜 8:00 JST） ─────

exports.scheduledNewsUpdate = onSchedule(
  {
    schedule: 'every monday 08:00',
    timeZone: 'Asia/Tokyo',
    region: REGION,
    secrets: [GITHUB_TOKEN, GCHAT_WEBHOOK_URL],
  },
  async () => {
    console.log('[ニュース自動収集] 開始');
    const sources = [
      { name: 'Joint',    url: `https://www.joint-kaigo.com/?s=${KEYWORD}` },
      { name: 'GemMed',   url: `https://gemmed.ghc-j.com/?s=${KEYWORD}` },
      { name: '介護経営', url: `https://kaigokeiei.com/?s=${KEYWORD}` },
    ];

    const articles = [];
    for (const src of sources) {
      try {
        const res = await fetch(src.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KaigoBot/1.0)' },
          timeout: 10000,
        });
        const html = await res.text();
        const $ = cheerio.load(html);
        $('article, .post, .article-item').slice(0, 5).each((_, el) => {
          const title = $(el).find('h2,h3,.entry-title').first().text().trim();
          const href  = $(el).find('a[href]').first().attr('href') || '';
          const date  = $(el).find('time,.date,.published').first().text().trim();
          if (title.includes(KEYWORD) && href) {
            const url = href.startsWith('http') ? href : `https://${new URL(src.url).hostname}${href}`;
            const dateMatch = date.match(/(\d{4})[年/](\d{1,2})/);
            articles.push({
              date:   dateMatch ? `${dateMatch[1]}/${String(dateMatch[2]).padStart(2,'0')}` : '',
              source: src.name,
              title,
              url,
            });
          }
        });
      } catch (e) {
        console.warn(`[${src.name}] scrape failed:`, e.message);
      }
    }

    // 厚生労働省は固定
    const fixed = [{
      date: '2025/12', source: '厚生労働省',
      title: '介護情報基盤について（厚生労働省 公式ページ）',
      url: 'https://www.mhlw.go.jp/stf/newpage_59231.html',
    }];

    // 重複除去・ソート
    const seen = new Set();
    const unique = [...fixed, ...articles].filter(a => {
      if (seen.has(a.url)) return false;
      seen.add(a.url); return true;
    }).slice(0, 8);

    // Firestore に保存（LP管理・CRMで参照）
    await db.doc('config/news').set({ items: unique, updatedAt: FieldValue.serverTimestamp() });
    console.log(`[ニュース自動収集] ${unique.length}件をFirestoreに保存`);

    // Google Chat 通知
    const webhook = GCHAT_WEBHOOK_URL.value();
    if (webhook) {
      const lines = unique.slice(0, 5).map(a => `• [${a.source}] ${a.date} — ${a.title.slice(0,40)}`);
      const msg = `*🗞️ 介護情報基盤 ニュース自動更新*\n件数: ${unique.length}件\n\n${lines.join('\n')}`;
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: msg }),
      });
    }
  }
);
