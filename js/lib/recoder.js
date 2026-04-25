(function (root, factory) {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = factory(require('xlsx'));
    } else {
        root.RecoderLib = factory(root.XLSX);
    }
})(typeof self !== 'undefined' ? self : this, function (XLSX) {

    /**
     * Reads a worksheet via SheetJS using the same options the app uses,
     * trims every cell, and splits header from data rows.
     *
     * Note on cell types: with `raw: false`, SheetJS returns the formatted
     * text for every cell, so numbers ("1.5") and booleans ("TRUE"/"FALSE")
     * arrive as strings. With `defval: ''`, missing cells inside the sheet
     * range are filled with the empty string, so `.trim()` is safe.
     */
    function parseSheetData(worksheet) {
        const data = XLSX.utils
            .sheet_to_json(worksheet, { header: 1, raw: false, defval: '', blankrows: false })
            .map(row => row.map(col => col.trim()));
        const [headers = [], ...rows] = data;
        return { headers, rows };
    }

    /**
     * Wraps each cell value into `{ value, lower }` for fast case-insensitive
     * lookup during recoding.
     */
    function cookRows(rows) {
        return rows.map(cols => cols.map(value => ({ value, lower: value?.toLowerCase() || '' })));
    }

    /**
     * Builds the per-column metadata used by the UI. Each column tracks the
     * Map of `lower -> first-seen original` for unique non-empty values
     * encountered in that column.
     */
    function buildColumnData(headers, cookedRows) {
        return headers.map((label, idx) => {
            const values = new Map();
            cookedRows.forEach(row => {
                if (row[idx].lower && !values.has(row[idx].lower)) {
                    values.set(row[idx].lower, row[idx].value);
                }
            });
            return { label, idx, values };
        });
    }

    /**
     * Merges the unique-values Maps from every selected column into one Map.
     * Uses Map.set semantics, so the *last* selected column to contain a
     * given lower-cased key wins for the displayed (original-case) label.
     */
    function collectValuesForSelection(columnData, selectedIndices) {
        const values = new Map();
        selectedIndices.forEach(idx => {
            columnData[idx].values.forEach((value, key) => values.set(key, value));
        });
        return values;
    }

    /**
     * Mirrors the UI's transformation-form generation: sort the displayed
     * (original-case) values with default Array.prototype.sort, then assign
     * sequential numeric codes 1..N to them. Returned items pair the
     * lower-cased lookup key with its proposed code.
     */
    function generateTransformationItems(valuesMap) {
        const sorted = Array.from(valuesMap.entries())
            .sort((a, b) => {
                const av = a[1];
                const bv = b[1];
                if (av < bv) return -1;
                if (av > bv) return 1;
                return 0;
            });
        return sorted.map(([key, label], i) => ({ key, label, code: String(i + 1) }));
    }

    /**
     * Apply a transformation map to the selected columns, mutating and
     * returning `finalData`. Reads the lower-cased lookup key from
     * `cookedRows` (the original parsed values), then writes the matching
     * transformation value into the corresponding finalData cell.
     *
     * NOTE: this preserves the existing behaviour exactly, including the
     * fact that an empty source cell (lookup key === '') resolves to
     * `undefined` from the transformation Map, and gets written as
     * `undefined` into finalData.
     */
    function applyRecode(finalData, cookedRows, selectedIndices, transformations) {
        cookedRows.forEach((row, idx) => {
            selectedIndices.forEach(colIdx => {
                finalData[idx][colIdx] = transformations.get(row[colIdx].lower);
            });
        });
        return finalData;
    }

    /**
     * Mirrors the existing download behaviour: walks every cell in the
     * worksheet's range (excluding the header row), and overwrites the
     * cell value with the matching finalData entry, leaving the cell type
     * (`.t`) and cached formatted text (`.w`) untouched.
     *
     * NOTE: cells whose `finalData` entry is `undefined` are left alone,
     * which preserves the ORIGINAL value of any cell that was either never
     * recoded or originally empty. See bug tests for the implications.
     */
    function writeFinalDataToWorksheet(worksheet, finalData) {
        const range = XLSX.utils.decode_range(worksheet['!ref']);
        for (let R = range.s.r + 1; R <= range.e.r; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const addr = XLSX.utils.encode_cell({ r: R, c: C });
                if (!worksheet[addr] || finalData[R - 1]?.[C] === undefined) continue;
                worksheet[addr].v = finalData[R - 1][C];
            }
        }
        return worksheet;
    }

    return {
        parseSheetData,
        cookRows,
        buildColumnData,
        collectValuesForSelection,
        generateTransformationItems,
        applyRecode,
        writeFinalDataToWorksheet,
    };
});
