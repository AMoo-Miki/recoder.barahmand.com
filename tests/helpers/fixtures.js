import * as XLSX from 'xlsx';

/**
 * Build an in-memory worksheet from a 2D array of native JS values
 * (strings, numbers, booleans, null/undefined). The first row is the
 * header. This mirrors the kind of file users actually upload.
 *
 * Returns { workbook, worksheet } so tests can either operate on the
 * worksheet directly or round-trip the workbook through write/read.
 */
function buildWorkbook(aoa, sheetName = 'Sheet1') {
    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    return { workbook, worksheet };
}

/**
 * Round-trip a workbook through xlsx serialization so we test the same
 * code path as a real upload (XLSX.read on an array buffer).
 */
function roundTrip(workbook) {
    const buf = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true });
    const reread = XLSX.read(buf, { type: 'array' });
    const sheetName = reread.SheetNames[0];
    return { workbook: reread, worksheet: reread.Sheets[sheetName] };
}

export { buildWorkbook, roundTrip };
