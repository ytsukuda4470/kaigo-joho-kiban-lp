export function formatDate(val: any): string {
  if (!val) return '';
  try {
    const d = val?.toDate ? val.toDate() : new Date(val);
    if (isNaN(d.getTime())) return String(val);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return String(val);
  }
}

export function formatDateShort(val: any): string {
  if (!val) return '';
  try {
    const d = val?.toDate ? val.toDate() : new Date(val);
    if (isNaN(d.getTime())) return String(val);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
  } catch {
    return String(val);
  }
}
