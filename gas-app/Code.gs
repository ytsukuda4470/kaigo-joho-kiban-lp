// ============================================================
//  介護情報基盤 CRM — Google Apps Script バックエンド
// ============================================================

// ▼ 設定: GASのスクリプトプロパティに SPREADSHEET_ID を登録してください
//   PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'YOUR_SHEET_ID')
//   または下の定数を直接書き換えてもOK

const SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';

// シート名
const SH_INQUIRIES = '問い合わせ';
const SH_ACTIONS   = '対応履歴';
const SH_FOLLOWUPS = 'フォローアップ';
const SH_TEMPLATES = 'メールテンプレート';

// 問い合わせシート標準ヘッダー
const INQUIRY_HEADERS = [
  'タイムスタンプ', 'メールアドレス', '法人名', '事業所名', '郵便番号', '都道府県',
  '電話番号', 'ご担当者名', '役職', '事業所数', 'ケアプラン連携', '国保連伝送',
  'ご興味のある点', 'お問い合わせ内容', '個人情報同意',
  '対応状況', '担当者', '最終更新', 'メモ'
];

// 問い合わせシートの追加列（既存列の後ろに追加）
const EXTRA_COLS = ['対応状況', '担当者', '最終更新', 'メモ'];

// 対応状況
const STATUSES = ['新規', '対応中', '現地訪問済', '完了', 'フォロー中'];

// ============================================================
//  エントリポイント
// ============================================================

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('介護基盤 管理ツール')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    const payload = parsePostPayload(e);

    // メール送信アクション（管理画面・Firebase Functions から呼び出し）
    if (payload.action === 'sendEmail') {
      if (!payload.to || !payload.subject) {
        return jsonResponse({ success: false, error: '宛先と件名は必須です' });
      }
      GmailApp.sendEmail(payload.to, payload.subject, payload.body || '', {
        name: '株式会社２７９',
        replyTo: 'kiban@279279.net',
      });
      return jsonResponse({ success: true });
    }

    const ss = getSpreadsheet();
    const inqSh = ensureInquirySheet(ss);
    const headers = inqSh.getRange(1, 1, 1, inqSh.getLastColumn()).getValues()[0];
    const now = new Date();

    const rowMap = {
      'タイムスタンプ': payload.timestamp || now,
      'メールアドレス': payload.email || '',
      '法人名': payload.corp || '',
      '事業所名': payload.office || '',
      '郵便番号': payload.zip || '',
      '都道府県': payload.prefecture || '',
      '電話番号': payload.phone || '',
      'ご担当者名': payload.name || '',
      '役職': payload.role || '',
      '事業所数': payload.officeCount || '',
      'ケアプラン連携': payload.careplanLinkage || '',
      '国保連伝送': payload.densou || '',
      'ご興味のある点': payload.interest || '',
      'お問い合わせ内容': payload.message || '',
      '個人情報同意': payload.privacy || '',
      '対応状況': '新規',
      '担当者': '',
      '最終更新': now,
      'メモ': '',
    };

    const row = headers.map(h => rowMap[h] ?? '');
    inqSh.appendRow(row);

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

function parsePostPayload(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  const body = e.postData.contents;
  try {
    return JSON.parse(body);
  } catch (_) {
    const params = {};
    body.split('&').forEach(pair => {
      const [k, v] = pair.split('=');
      if (!k) return;
      params[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
    });
    return params;
  }
}

function ensureInquirySheet(ss) {
  const inqSh = getOrCreateSheet(ss, SH_INQUIRIES, INQUIRY_HEADERS);
  const existingHeaders = inqSh.getRange(1, 1, 1, inqSh.getLastColumn()).getValues()[0];

  INQUIRY_HEADERS.forEach(col => {
    if (!existingHeaders.includes(col)) {
      const nextCol = inqSh.getLastColumn() + 1;
      inqSh.getRange(1, nextCol).setValue(col)
        .setBackground('#1E3A5F').setFontColor('#FFFFFF').setFontWeight('bold');
      if (col === '対応状況' && inqSh.getLastRow() > 1) {
        inqSh.getRange(2, nextCol, inqSh.getLastRow() - 1, 1).setValue('新規');
      }
      if (col === '最終更新' && inqSh.getLastRow() > 1) {
        inqSh.getRange(2, nextCol, inqSh.getLastRow() - 1, 1).setValue(new Date());
      }
    }
  });
  return inqSh;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  ユーザー情報（Google userinfo API）
// ============================================================

function getCurrentUser() {
  try {
    const token = ScriptApp.getOAuthToken();
    const res = UrlFetchApp.fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() === 200) {
      const info = JSON.parse(res.getContentText());
      return {
        email:       info.email       || '',
        displayName: info.name        || info.email.split('@')[0],
        givenName:   info.given_name  || '',
        familyName:  info.family_name || '',
        picture:     info.picture     || '',
      };
    }
    // fallback
    const email = Session.getActiveUser().getEmail();
    return { email, displayName: email.split('@')[0], picture: '' };
  } catch (e) {
    return { email: '', displayName: 'ゲスト', picture: '' };
  }
}

// ============================================================
//  スプレッドシートユーティリティ
// ============================================================

function getSpreadsheet() {
  if (!SPREADSHEET_ID) throw new Error('SPREADSHEET_ID が未設定です');
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getOrCreateSheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers && headers.length > 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.getRange(1, 1, 1, headers.length)
        .setBackground('#1E3A5F').setFontColor('#FFFFFF').setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map((row, i) => {
    const obj = { _row: i + 2 };
    headers.forEach((h, j) => { obj[h] = row[j]; });
    return obj;
  });
}

function colIndex(sheet, colName) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.indexOf(colName); // 0-based
}

// ============================================================
//  初期セットアップ（初回のみ実行）
// ============================================================

function setupSheets() {
  const ss = getSpreadsheet();

  // 問い合わせシートに追加列を追加
  const inqSh = ss.getSheetByName(SH_INQUIRIES);
  if (inqSh) {
    const existingHeaders = inqSh.getRange(1, 1, 1, inqSh.getLastColumn()).getValues()[0];
    EXTRA_COLS.forEach(col => {
      if (!existingHeaders.includes(col)) {
        const nextCol = inqSh.getLastColumn() + 1;
        inqSh.getRange(1, nextCol).setValue(col)
          .setBackground('#1E3A5F').setFontColor('#FFFFFF').setFontWeight('bold');
        // デフォルト値
        if (col === '対応状況' && inqSh.getLastRow() > 1) {
          inqSh.getRange(2, nextCol, inqSh.getLastRow() - 1, 1).setValue('新規');
        }
      }
    });
  }

  // 対応履歴シート
  getOrCreateSheet(ss, SH_ACTIONS, [
    'ID', '問い合わせID', '日時', '種別', '内容', '担当者'
  ]);

  // フォローアップシート
  getOrCreateSheet(ss, SH_FOLLOWUPS, [
    'ID', '問い合わせID', '予定日', '件名', '内容', 'ステータス', '担当者', '完了日'
  ]);

  // メールテンプレートシート
  const tmplSh = getOrCreateSheet(ss, SH_TEMPLATES, [
    'ID', '名前', '件名', '本文'
  ]);
  // デフォルトテンプレートを挿入
  if (tmplSh.getLastRow() < 2) {
    tmplSh.getRange(2, 1, 3, 4).setValues([
      [
        '1', '受付自動返信',
        '【株式会社２７９】お問い合わせを受け付けました',
        `{{名前}} 様\n\nお問い合わせいただきありがとうございます。\n株式会社２７９の{{担当者}}です。\n\n内容を確認の上、2営業日以内にご連絡いたします。\n\n【お問い合わせ内容】\n{{内容}}\n\n---\n株式会社２７９\nTEL: 050-1741-3279`
      ],
      [
        '2', '現地訪問前確認',
        '【株式会社２７９】ご訪問のご確認',
        `{{名前}} 様\n\n{{訪問日時}}にお伺いする予定です。\nご不明な点があればお知らせください。\n\n---\n株式会社２７９\nTEL: 050-1741-3279`
      ],
      [
        '3', '導入後フォロー',
        '【株式会社２７９】介護情報基盤 ご利用状況のご確認',
        `{{名前}} 様\n\n先日はご導入いただきありがとうございました。\n導入から{{経過}}が経ちましたが、ご不明な点はございませんか？\n\n---\n株式会社２７９\nTEL: 050-1741-3279`
      ],
    ]);
  }

  return { success: true, message: 'シートのセットアップが完了しました' };
}

// ============================================================
//  ダッシュボード
// ============================================================

function getDashboardStats() {
  try {
    const ss = getSpreadsheet();
    const inqSh = ss.getSheetByName(SH_INQUIRIES);
    const fuSh  = ss.getSheetByName(SH_FOLLOWUPS);

    const inquiries = sheetToObjects(inqSh);
    const followups = fuSh ? sheetToObjects(fuSh) : [];

    // ステータス別カウント
    const statusCounts = {};
    STATUSES.forEach(s => statusCounts[s] = 0);
    statusCounts['未設定'] = 0;
    inquiries.forEach(r => {
      const s = r['対応状況'] || '未設定';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });

    // 今日・今週の新規
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart  = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);
    const todayNew   = inquiries.filter(r => new Date(r['タイムスタンプ']) >= todayStart).length;
    const weekNew    = inquiries.filter(r => new Date(r['タイムスタンプ']) >= weekStart).length;

    // 期限切れフォローアップ
    const overdueFu = followups.filter(r =>
      r['ステータス'] !== '完了' && r['予定日'] && new Date(r['予定日']) < todayStart
    ).length;

    // 直近5件
    const recent = inquiries
      .sort((a, b) => new Date(b['タイムスタンプ']) - new Date(a['タイムスタンプ']))
      .slice(0, 5)
      .map(r => ({
        id: r._row,
        timestamp: formatDate(r['タイムスタンプ']),
        corp: r['法人名'] || '',
        office: r['事業所名'] || '',
        status: r['対応状況'] || '新規',
        name: r['ご担当者名'] || '',
      }));

    return {
      total: inquiries.length,
      todayNew,
      weekNew,
      statusCounts,
      overdueFu,
      recent,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ============================================================
//  問い合わせ一覧
// ============================================================

function getInquiries(opts) {
  try {
    opts = opts || {};
    const ss = getSpreadsheet();
    const inqSh = ss.getSheetByName(SH_INQUIRIES);
    let rows = sheetToObjects(inqSh);

    // フィルタ
    if (opts.status && opts.status !== 'all') {
      rows = rows.filter(r => (r['対応状況'] || '新規') === opts.status);
    }
    if (opts.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter(r =>
        (r['法人名'] || '').toLowerCase().includes(q) ||
        (r['事業所名'] || '').toLowerCase().includes(q) ||
        (r['ご担当者名'] || '').toLowerCase().includes(q) ||
        (r['メールアドレス'] || '').toLowerCase().includes(q)
      );
    }

    // 日付降順
    rows.sort((a, b) => new Date(b['タイムスタンプ']) - new Date(a['タイムスタンプ']));

    // 整形
    return rows.map(r => ({
      id: r._row,
      timestamp: formatDate(r['タイムスタンプ']),
      corp: r['法人名'] || '',
      office: r['事業所名'] || '',
      prefecture: r['都道府県'] || '',
      name: r['ご担当者名'] || '',
      email: r['メールアドレス'] || '',
      phone: r['電話番号'] || '',
      status: r['対応状況'] || '新規',
      assignee: r['担当者'] || '',
      lastUpdated: formatDate(r['最終更新']),
      interest: r['ご興味のある点'] || r['ご興味'] || '',
    }));
  } catch (e) {
    return { error: e.message };
  }
}

// ============================================================
//  問い合わせ詳細
// ============================================================

function getInquiryDetail(rowNum) {
  try {
    const ss = getSpreadsheet();
    const inqSh = ss.getSheetByName(SH_INQUIRIES);
    const actSh = ss.getSheetByName(SH_ACTIONS);
    const fuSh  = ss.getSheetByName(SH_FOLLOWUPS);

    const headers = inqSh.getRange(1, 1, 1, inqSh.getLastColumn()).getValues()[0];
    const rowData = inqSh.getRange(rowNum, 1, 1, inqSh.getLastColumn()).getValues()[0];
    const inquiry = {};
    headers.forEach((h, i) => { inquiry[h] = rowData[i]; });
    inquiry._row = rowNum;

    // 対応履歴
    const actions = actSh
      ? sheetToObjects(actSh)
          .filter(r => String(r['問い合わせID']) === String(rowNum))
          .sort((a, b) => new Date(b['日時']) - new Date(a['日時']))
          .map(r => ({
            id: r['ID'],
            date: formatDate(r['日時']),
            type: r['種別'],
            content: r['内容'],
            staff: r['担当者'],
          }))
      : [];

    // フォローアップ
    const followups = fuSh
      ? sheetToObjects(fuSh)
          .filter(r => String(r['問い合わせID']) === String(rowNum))
          .sort((a, b) => new Date(a['予定日']) - new Date(b['予定日']))
          .map(r => ({
            id: r['ID'],
            dueDate: formatDateShort(r['予定日']),
            subject: r['件名'],
            content: r['内容'],
            status: r['ステータス'],
            staff: r['担当者'],
          }))
      : [];

    return {
      id: rowNum,
      timestamp: formatDate(inquiry['タイムスタンプ']),
      corp: inquiry['法人名'] || '',
      office: inquiry['事業所名'] || '',
      zip: inquiry['郵便番号'] || '',
      prefecture: inquiry['都道府県'] || '',
      phone: inquiry['電話番号'] || '',
      name: inquiry['ご担当者名'] || '',
      role: inquiry['役職'] || '',
      email: inquiry['メールアドレス'] || '',
      officeCount: inquiry['事業所数'] || '',
      careplanLinkage: inquiry['ケアプラン連携'] || '',
      densou: inquiry['国保連伝送'] || '',
      interest: inquiry['ご興味のある点'] || inquiry['ご興味'] || '',
      message: inquiry['お問い合わせ内容'] || '',
      status: inquiry['対応状況'] || '新規',
      assignee: inquiry['担当者'] || '',
      lastUpdated: formatDate(inquiry['最終更新']),
      notes: inquiry['メモ'] || '',
      actions,
      followups,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ============================================================
//  問い合わせ更新
// ============================================================

function updateInquiry(rowNum, updates) {
  try {
    const ss = getSpreadsheet();
    const inqSh = ss.getSheetByName(SH_INQUIRIES);
    const headers = inqSh.getRange(1, 1, 1, inqSh.getLastColumn()).getValues()[0];

    Object.entries(updates).forEach(([key, value]) => {
      const col = headers.indexOf(key);
      if (col >= 0) {
        inqSh.getRange(rowNum, col + 1).setValue(value);
      }
    });

    // 最終更新を記録
    const lastUpdatedCol = headers.indexOf('最終更新');
    if (lastUpdatedCol >= 0) {
      inqSh.getRange(rowNum, lastUpdatedCol + 1).setValue(new Date());
    }

    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
}

// ============================================================
//  対応履歴追加
// ============================================================

function addAction(inquiryId, type, content) {
  try {
    const ss = getSpreadsheet();
    const actSh = getOrCreateSheet(ss, SH_ACTIONS, ['ID', '問い合わせID', '日時', '種別', '内容', '担当者']);
    const user = getCurrentUser();
    const newId = actSh.getLastRow(); // simple sequential ID
    actSh.appendRow([newId, inquiryId, new Date(), type, content, user.displayName]);
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
}

// ============================================================
//  フォローアップ
// ============================================================

function getFollowUps(opts) {
  try {
    opts = opts || {};
    const ss = getSpreadsheet();
    const fuSh = getOrCreateSheet(ss, SH_FOLLOWUPS, ['ID', '問い合わせID', '予定日', '件名', '内容', 'ステータス', '担当者', '完了日']);
    const inqSh = ss.getSheetByName(SH_INQUIRIES);
    const inquiries = sheetToObjects(inqSh);
    const inqMap = {};
    inquiries.forEach(r => { inqMap[r._row] = r; });

    let rows = sheetToObjects(fuSh);

    if (opts.status === 'pending') {
      rows = rows.filter(r => r['ステータス'] !== '完了');
    }

    rows.sort((a, b) => new Date(a['予定日']) - new Date(b['予定日']));

    const today = new Date();
    today.setHours(0,0,0,0);

    return rows.map(r => {
      const inq = inqMap[r['問い合わせID']] || {};
      const dueDate = r['予定日'] ? new Date(r['予定日']) : null;
      dueDate && dueDate.setHours(0,0,0,0);
      const isOverdue = dueDate && dueDate < today && r['ステータス'] !== '完了';
      const isToday = dueDate && dueDate.getTime() === today.getTime();
      return {
        id: r['ID'],
        rowNum: r._row,
        inquiryId: r['問い合わせID'],
        corp: inq['法人名'] || '',
        office: inq['事業所名'] || '',
        name: inq['ご担当者名'] || '',
        email: inq['メールアドレス'] || '',
        dueDate: formatDateShort(r['予定日']),
        subject: r['件名'],
        content: r['内容'],
        status: r['ステータス'],
        staff: r['担当者'],
        isOverdue,
        isToday,
      };
    });
  } catch (e) {
    return { error: e.message };
  }
}

function addFollowUp(inquiryId, dueDate, subject, content) {
  try {
    const ss = getSpreadsheet();
    const fuSh = getOrCreateSheet(ss, SH_FOLLOWUPS, ['ID', '問い合わせID', '予定日', '件名', '内容', 'ステータス', '担当者', '完了日']);
    const user = getCurrentUser();
    const newId = fuSh.getLastRow();
    fuSh.appendRow([newId, inquiryId, new Date(dueDate), subject, content, '未対応', user.displayName, '']);
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
}

function completeFollowUp(rowNum) {
  try {
    const ss = getSpreadsheet();
    const fuSh = ss.getSheetByName(SH_FOLLOWUPS);
    const headers = fuSh.getRange(1, 1, 1, fuSh.getLastColumn()).getValues()[0];
    const statusCol = headers.indexOf('ステータス') + 1;
    const doneDateCol = headers.indexOf('完了日') + 1;
    if (statusCol > 0) fuSh.getRange(rowNum, statusCol).setValue('完了');
    if (doneDateCol > 0) fuSh.getRange(rowNum, doneDateCol).setValue(new Date());
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
}

// ============================================================
//  メール送信
// ============================================================

function sendEmail(to, subject, body, inquiryId) {
  try {
    GmailApp.sendEmail(to, subject, body, {
      name: '株式会社２７９',
      replyTo: Session.getActiveUser().getEmail(),
    });

    // 対応履歴に記録
    if (inquiryId) {
      addAction(inquiryId, 'メール送信', `件名: ${subject}\n\n${body}`);
    }

    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
}

function getEmailTemplates() {
  try {
    const ss = getSpreadsheet();
    const sh = getOrCreateSheet(ss, SH_TEMPLATES, ['ID', '名前', '件名', '本文']);
    return sheetToObjects(sh).map(r => ({
      id: r['ID'],
      name: r['名前'],
      subject: r['件名'],
      body: r['本文'],
    }));
  } catch (e) {
    return [];
  }
}

function saveEmailTemplate(id, name, subject, body) {
  try {
    const ss = getSpreadsheet();
    const sh = getOrCreateSheet(ss, SH_TEMPLATES, ['ID', '名前', '件名', '本文']);
    const rows = sheetToObjects(sh);
    const existing = rows.find(r => String(r['ID']) === String(id));
    if (existing) {
      const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      ['名前', '件名', '本文'].forEach(col => {
        const ci = headers.indexOf(col) + 1;
        if (ci > 0) {
          const val = col === '名前' ? name : col === '件名' ? subject : body;
          sh.getRange(existing._row, ci).setValue(val);
        }
      });
    } else {
      const newId = sh.getLastRow();
      sh.appendRow([newId, name, subject, body]);
    }
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
}

// ============================================================
//  ユーティリティ
// ============================================================

function formatDate(val) {
  if (!val) return '';
  try {
    const d = new Date(val);
    if (isNaN(d)) return String(val);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  } catch { return String(val); }
}

function formatDateShort(val) {
  if (!val) return '';
  try {
    const d = new Date(val);
    if (isNaN(d)) return String(val);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  } catch { return String(val); }
}

// ============================================================
//  LP 管理 — GitHub API 連携
//  スクリプトプロパティ: GITHUB_TOKEN (contents + workflow スコープの PAT)
// ============================================================

const GITHUB_OWNER = 'ytsukuda4470';
const GITHUB_REPO  = 'kaigo-joho-kiban-lp';
const LP_FILE_PATH = 'index.html';

function _githubHeaders() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN') || '';
  if (!token) throw new Error('GITHUB_TOKEN が未設定です。スクリプトプロパティに登録してください。');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };
}

/** index.html の生コンテンツと最新 SHA を取得 */
function _getLPFile() {
  const res = UrlFetchApp.fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${LP_FILE_PATH}`,
    { headers: _githubHeaders(), muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) throw new Error('GitHub からファイルを取得できませんでした: ' + res.getContentText());
  const data = JSON.parse(res.getContentText());
  // Base64 デコード（GAS は Utilities.newBlob で処理）
  const html = Utilities.newBlob(Utilities.base64Decode(data.content.replace(/\n/g, ''))).getDataAsString();
  return { html, sha: data.sha };
}

/** NEWS_ITEMS_START〜END 間の <a> タグをパースしてリストを返す */
function getLPNewsItems() {
  try {
    const { html, sha } = _getLPFile();
    const blockMatch = html.match(/<!-- NEWS_ITEMS_START -->([\s\S]*?)<!-- NEWS_ITEMS_END -->/);
    if (!blockMatch) return { items: [], sha, error: null };

    const block = blockMatch[1];
    const items = [];
    const aRe = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = aRe.exec(block)) !== null) {
      const url   = m[1];
      const inner = m[2];
      const dateM   = inner.match(/text-gray-400[^>]*>([^<]+)<\/span>/);
      const srcM    = inner.match(/text-primary[^>]*>([^<]+)<\/span>/);
      const titleM  = inner.match(/<p[^>]*>\s*([\s\S]*?)\s*<\/p>/);
      items.push({
        url,
        date:   dateM  ? dateM[1].trim()  : '',
        source: srcM   ? srcM[1].trim()   : '',
        title:  titleM ? titleM[1].trim().replace(/\s+/g, ' ') : '',
      });
    }
    return { items, sha, error: null };
  } catch (e) {
    return { items: [], sha: '', error: e.message };
  }
}

/** ニュースアイテムを HTML に変換 */
function _articleHtml(art) {
  const title = art.title.length > 60 ? art.title.slice(0, 60) + '…' : art.title;
  return `                <a href="${art.url}" target="_blank" rel="noopener noreferrer"\n` +
    `                   class="reveal flex gap-4 bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow border border-gray-100 group">\n` +
    `                    <div class="flex-shrink-0 text-center">\n` +
    `                        <span class="block text-xs text-gray-400">${art.date}</span>\n` +
    `                        <span class="block text-xs font-bold text-primary">${art.source}</span>\n` +
    `                    </div>\n` +
    `                    <div class="flex-1 min-w-0">\n` +
    `                        <p class="text-sm font-medium text-gray-800 group-hover:text-primary transition-colors line-clamp-2">\n` +
    `                            ${title}\n` +
    `                        </p>\n` +
    `                        <span class="mt-1 inline-flex items-center text-xs text-primary/70">\n` +
    `                            <i class="fas fa-external-link-alt mr-1 text-xs"></i>記事を読む\n` +
    `                        </span>\n` +
    `                    </div>\n` +
    `                </a>`;
}

/** ニュースアイテムを保存して GitHub に commit */
function saveLPNewsItems(items) {
  try {
    const { html, sha } = _getLPFile();
    const newBlock =
      '                <!-- NEWS_ITEMS_START -->\n' +
      items.map(a => _articleHtml(a)).join('\n') +
      '\n                <!-- NEWS_ITEMS_END -->';
    const newHtml = html.replace(
      /<!-- NEWS_ITEMS_START -->[\s\S]*?<!-- NEWS_ITEMS_END -->/,
      newBlock
    );
    if (newHtml === html) return { success: false, error: 'マーカーが見つかりませんでした' };

    const encoded = Utilities.base64Encode(Utilities.newBlob(newHtml).getBytes());
    const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    const body = JSON.stringify({
      message: `LP ニュース手動更新 ${now}`,
      content: encoded,
      sha,
    });
    const res = UrlFetchApp.fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${LP_FILE_PATH}`,
      { method: 'put', headers: _githubHeaders(), payload: body, muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200 && res.getResponseCode() !== 201) {
      return { success: false, error: 'GitHub commit 失敗: ' + res.getContentText() };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** GitHub Actions ワークフローを手動トリガー */
function triggerNewsUpdate() {
  try {
    const res = UrlFetchApp.fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/update-news.yml/dispatches`,
      {
        method: 'post',
        headers: _githubHeaders(),
        payload: JSON.stringify({ ref: 'main', inputs: { force_notify: 'true' } }),
        muteHttpExceptions: true,
      }
    );
    // 204 No Content = success
    return { success: res.getResponseCode() === 204, status: res.getResponseCode() };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** 最新の workflow 実行状況を取得 */
function getWorkflowStatus() {
  try {
    const res = UrlFetchApp.fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/update-news.yml/runs?per_page=1`,
      { headers: _githubHeaders(), muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return { run: null };
    const data = JSON.parse(res.getContentText());
    const run = data.workflow_runs?.[0];
    if (!run) return { run: null };
    return {
      run: {
        status:     run.status,
        conclusion: run.conclusion,
        createdAt:  formatDate(run.created_at),
        url:        run.html_url,
      }
    };
  } catch (e) {
    return { run: null, error: e.message };
  }
}
