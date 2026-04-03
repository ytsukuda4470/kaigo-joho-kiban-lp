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

// 問い合わせシートの追加列（既存列の後ろに追加）
const EXTRA_COLS = ['対応状況', '担当者', '最終更新', 'メモ'];

// 対応状況
const STATUSES = ['新規', '対応中', '現地訪問済', '完了', 'フォロー中'];

// ============================================================
//  エントリポイント
// ============================================================

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('介護情報基盤 CRM')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
//  ユーザー情報
// ============================================================

function getCurrentUser() {
  try {
    const user = Session.getActiveUser();
    const email = user.getEmail();
    return {
      email: email,
      displayName: email.split('@')[0].replace(/\./g, ' '),
    };
  } catch (e) {
    return { email: 'unknown', displayName: 'ゲスト' };
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
