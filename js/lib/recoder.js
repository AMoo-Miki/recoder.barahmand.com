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
        // SheetJS keeps fully-blank rows when `defval: ''` is set, even
        // with `blankrows: false` — drop them ourselves so they don't
        // pollute the preview or the recoded output.
        return { headers, rows: rows.filter(row => row.some(cell => cell !== '')) };
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
    function generateTransformationItems(valuesMap, priorCodes) {
        // Sort case-insensitively so 'Banana' and 'apple' end up in
        // alphabetic (rather than ASCII) order. Array.prototype.sort is
        // stable since ES2019, so identical labels keep their insertion
        // order.
        const sorted = Array.from(valuesMap.entries())
            .sort((a, b) => a[1].toLowerCase().localeCompare(b[1].toLowerCase()));

        // When the caller supplies `priorCodes` (a Map of key -> code
        // already shown to the user), keep those codes so adding a new
        // column doesn't silently re-number the columns the user has
        // already worked on. Brand-new keys claim the next unused
        // integer instead of restarting from 1.
        if (priorCodes && priorCodes.size > 0) {
            const used = new Set();
            priorCodes.forEach(v => { if (v !== '' && v != null) used.add(String(v)); });
            let nextCode = 1;
            return sorted.map(([key, label]) => {
                const prior = priorCodes.get(key);
                if (prior !== undefined && prior !== '' && prior !== null) {
                    return { key, label, code: String(prior) };
                }
                while (used.has(String(nextCode))) nextCode++;
                const code = String(nextCode);
                used.add(code);
                return { key, label, code };
            });
        }

        return sorted.map(([key, label], i) => ({ key, label, code: String(i + 1) }));
    }

    /**
     * Apply a transformation map to the selected columns, mutating and
     * returning `finalData`. Reads the lower-cased lookup key from
     * `cookedRows` (the original parsed values), then writes the matching
     * transformation value into the corresponding finalData cell.
     *
     * Empty source cells (lookup key === '') and cells whose lookup key
     * has no entry in `transformations` are left as-is, so partial
     * transformation maps don't silently corrupt rows.
     */
    function applyRecode(finalData, cookedRows, selectedIndices, transformations) {
        cookedRows.forEach((row, idx) => {
            selectedIndices.forEach(colIdx => {
                const key = row[colIdx].lower;
                if (key === '') return;
                const replacement = transformations.get(key);
                if (replacement === undefined) return;
                finalData[idx][colIdx] = replacement;
            });
        });
        return finalData;
    }

    /**
     * Walks every cell in the worksheet's range (excluding the header
     * row) and overwrites the cell value with the matching finalData
     * entry. Re-syncs the cell type (`.t`) to match the new value's
     * runtime type, and clears the cached formatted text (`.w`) so
     * downstream readers re-format from `.v` instead of showing the
     * stale pre-recode label.
     *
     * Cells whose `finalData` entry is `undefined` are left alone, which
     * preserves the ORIGINAL value of any cell that was either never
     * recoded or originally empty.
     */
    function writeFinalDataToWorksheet(worksheet, finalData) {
        const range = XLSX.utils.decode_range(worksheet['!ref']);
        for (let R = range.s.r + 1; R <= range.e.r; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const addr = XLSX.utils.encode_cell({ r: R, c: C });
                const cell = worksheet[addr];
                if (!cell) continue;
                const newVal = finalData[R - 1]?.[C];
                if (newVal === undefined) continue;
                cell.v = newVal;
                if (typeof newVal === 'number') cell.t = 'n';
                else if (typeof newVal === 'boolean') cell.t = 'b';
                else cell.t = 's';
                delete cell.w;
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
