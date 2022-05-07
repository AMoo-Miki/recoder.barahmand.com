const rawData = [];
const finalData = [];
const columnData = [];

const excelDiv = document.querySelector('.excel');
const transformationsForm = document.querySelector('#transformations');
const fileSelector = document.querySelector('#srcFile');
const selectedColumnsList = document.querySelector('#selectedCols');

let isPointerPressed = false;
let wasColumnSelected = false;
let workbook;
let worksheet;
let filename;
let updateSelectionsFrame;

const render = () => {
    const columnsLength = columnData.length;
    const headerText = columnData.map((col, i) => `<abbr class="header col-${i % columnsLength % 2 ? 'odd' : 'even'} col-${i % columnsLength}" title="${col.label.replace(/"/g, '&quot;')}" data-idx="${i}">${col.label}</abbr>`).join('');
    const rowsText = finalData.flat().map((row, i) => `<abbr class="row-${Math.floor(i / columnsLength) % 2 ? 'odd' : 'even'} col-${i % columnsLength % 2 ? 'odd' : 'even'} col-${i % columnsLength}" title="${row?.replace(/"/g, '&quot;')}">${row ?? ''}</abbr>`).join('');
    const frag = document.createRange().createContextualFragment(headerText + rowsText);

    const selectedClassList = columnData.filter(col => col.selected).map(col => `.col-${col.idx}`);
    if (selectedClassList.length) {
        frag.querySelectorAll(selectedClassList.join(', ')).forEach(el => {
            el.classList.add('selected');
        });
    }

    excelDiv.textContent = '';
    excelDiv.appendChild(frag);
    excelDiv.className = `excel cols-${columnsLength}`;

    updateSelections();
};

const updateCSS = () => {
    const columnsLength = columnData.length;
    let styleEl = document.head.querySelector(`.cols-def-${columnsLength}`);
    if (styleEl) return;

    styleEl = document.createElement('style');
    styleEl.classList.add(`cols-def-${columnData.length}`);
    document.head.appendChild(styleEl);

    const styleSheet = styleEl.sheet;
    styleSheet.insertRule(`.cols-${columnsLength} { grid-template-columns: repeat(${columnsLength}, 16rem); }`, 0);
    styleSheet.insertRule(`.cols-${columnsLength} > *:nth-child(${columnsLength}n + 1) { border-left: 0; }`, 1);
    styleSheet.insertRule(`.cols-${columnsLength} > *:nth-last-child(-n + ${columnsLength}) { border-bottom: 0; }`, 2);
};

const recode = (cols, transformations) => {
    const colIndices = cols.split(',');
    rawData.forEach((row, idx) => {
        colIndices.forEach(colIdx => {
            finalData[idx][colIdx] = transformations.get(rawData[idx][colIdx].lower);
        });
    });

    render();
};

const fileChanged = selectedFile => {
    if (!selectedFile) return;

    document.body.classList.add('file-selected', 'file-loading');

    setTimeout(async () => {
        await loadFile(selectedFile);
        requestAnimationFrame(() => {
            document.body.classList.remove('file-loading');
        });
    }, 1000);
}

const loadFile = async selectedFile => {
    if (!selectedFile) return;

    filename = selectedFile.name;
    workbook = XLSX.read(await selectedFile.arrayBuffer());
    worksheet = workbook.Sheets[Object.keys(workbook.Sheets)[0]];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '', blankrows: false })
        .map(row => row.map(col => col.trim()));
    const [columns, ...rest] = data;
    rawData.splice(0, rawData.length);
    rawData.push(...rest.map(cols => cols.map(value => ({ value, lower: value?.toLowerCase() || '' }))));
    finalData.splice(0, finalData.length);
    finalData.push(...rest);
    columnData.splice(0, columnData.length);
    const colData = columns.map((label, idx) => {
        const values = new Map();
        rawData.forEach(row => {
            if (row[idx].lower && !values.has(row[idx].lower))
                values.set(row[idx].lower, row[idx].value);
        });
        return { label, idx, values };
    });
    columnData.push(...colData);

    render();
    updateCSS();
};

const selectColumn = (idx, select = true) => {
    columnData[idx].selected = select;
    excelDiv.querySelectorAll(`.col-${idx}`).forEach(el => {
        el.classList.toggle('selected', select);
    });

    updateSelections();
};

const updateSelections = () => {
    const selectedCols = columnData.filter(col => col.selected);
    const hasSelections = selectedCols.length !== 0;
    excelDiv.classList.toggle('no-selections', !hasSelections);
    excelDiv.classList.toggle('has-selections', hasSelections);

    if (hasSelections) {
        const selectionList = selectedCols.map(col => `<a>${col.label}</a>`).join('');
        const colsFrag = document.createRange().createContextualFragment(selectionList);

        const values = new Map();
        const selectedIndices = selectedCols.map(col => col.idx);

        /*
        rawData.forEach(row => {
            selectedIndices.forEach(idx => {
                if (row[idx].lower && !values.has(row[idx].lower))
                    values.set(row[idx].lower, row[idx].value);
            });
        });
         */

        selectedIndices.forEach(idx => {
            columnData[idx].values.forEach((value, key) => values.set(key, value));
        });

        const texts = Array.from(values.values()).sort()
            .map((text, i) => `<div><input type="number" value="${i + 1}" name="${text.toLowerCase().replace(/"/g, '&quot;')}"><label>${text}</label></div>`)
            .join('');

        const frag = document.createRange().createContextualFragment(texts + `<input name="cols" type="hidden" value="${selectedIndices.join(',')}" />`);
        const hiddenCols = transformationsForm.querySelector('input[name="cols"]');
        if (hiddenCols) hiddenCols.value = selectedIndices.join(',');

        if (updateSelectionsFrame) cancelAnimationFrame(updateSelectionsFrame);
        updateSelectionsFrame = requestAnimationFrame(() => {
            selectedColumnsList.replaceChildren(colsFrag);
            if (frag.childNodes.length !== transformationsForm.childNodes.length || !Array.from(frag.childNodes).every((child, i) => child.isEqualNode(transformationsForm.childNodes[i])))
                transformationsForm.replaceChildren(frag);
        });
    }
};

const getColumnForCell = el => {
    let col;
    Array.from(el.classList).some(cls => {
        if (/col-\d+/.test(cls)) {
            col = cls;
            return true;
        }
    });

    return col;
};

const pointerDragged = e => {
    if (!isPointerPressed) return;

    const target = e.target.closest('abbr');
    if (!target || target.classList.contains('selected')) return;

    const col = getColumnForCell(target);
    if (!col) return;

    const colHeader = excelDiv.querySelector(`.header.${col}`);
    const colIdx = parseInt(colHeader.dataset.idx);

    selectColumn(colIdx, true);
};

fileSelector.addEventListener('change', e => {
    fileChanged(e.target.files?.[0]);
}, false);

document.getElementById('reset').addEventListener('click', () => {
    rawData.splice(0, rawData.length);
    finalData.splice(0, finalData.length);
    columnData.splice(0, columnData.length);
    fileSelector.value = null;
    excelDiv.textContent = '';
    excelDiv.className = `excel blank`;
    excelDiv.appendChild(document.createRange().createContextualFragment(`<label for="srcFile"><span>Drag and drop an Excel file here to begin.<br>You can also click here or use the Browse button to add a file.</span></label>`))
    document.body.classList.remove('file-selected');
}, false);

excelDiv.addEventListener('pointerdown', e => {
    const target = e.target.closest('abbr');
    if (!target) return;

    const col = getColumnForCell(target);
    if (!col) return;

    const colHeader = excelDiv.querySelector(`.header.${col}`);
    const colIdx = parseInt(colHeader.dataset.idx);
    wasColumnSelected = colHeader.classList.contains('selected');

    selectColumn(colIdx, true);

    isPointerPressed = colIdx;
});

document.addEventListener('pointerup', e => {
    const target = e.target.closest('abbr');
    if (!target) return;

    const col = getColumnForCell(target);
    if (!col) return;

    const colHeader = excelDiv.querySelector(`.header.${col}`);
    const colIdx = parseInt(colHeader.dataset.idx);

    if (isPointerPressed === colIdx && wasColumnSelected) selectColumn(colIdx, false);
    isPointerPressed = false;
    wasColumnSelected = false;
}, false);

excelDiv.addEventListener('pointerover', pointerDragged, false);

excelDiv.addEventListener('drop', e => {
    e.preventDefault();
    if (document.body.classList.contains('file-loading')) return;
    fileChanged(e.dataTransfer.files?.[0]);
    fileSelector.files = e.dataTransfer.files;
}, false);

excelDiv.addEventListener('dragover', e => {
    e.preventDefault();
    if (document.body.classList.contains('file-loading')) return;
    excelDiv.classList.add('dragover');
});

excelDiv.addEventListener('dragleave', e => {
    e.preventDefault();
    excelDiv.classList.remove('dragover');
});

document.querySelector('#clear-cols').addEventListener('click', e => {
    columnData.forEach(col => col.selected = false);
    excelDiv.querySelectorAll(`.col-even.selected, .col-odd.selected`).forEach(el => {
        el.classList.remove('selected');
    });

    updateSelections();
});

document.querySelector('#apply-transformation').addEventListener('click', e => {
    const data = new Map();
    transformationsForm.querySelectorAll('input[type="number"]').forEach(el => {
        data.set(el.getAttribute('name').replace(/&quot;/g, '"'), el.value);
    });

    const cols = transformationsForm.querySelector('input[name="cols"]').value;

    recode(cols, data);
});

document.querySelector('#download').addEventListener('click', e => {
    e.preventDefault();
    const range = XLSX.utils.decode_range(worksheet["!ref"]);
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const addr = XLSX.utils.encode_cell({ r: R, c: C });
            if (!worksheet[addr] || finalData[R - 1]?.[C] === undefined) continue;
            worksheet[addr].v = finalData[R - 1][C];
        }
    }

    XLSX.writeFile(workbook, filename.replace(/\.[^.]*$/, '') + '-recoded.xlsx', { compression: true, type: 'xlsx' });
});