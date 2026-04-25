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

const makeAbbr = (text, classes, title, dataset) => {
    const el = document.createElement('abbr');
    el.classList.add(...classes);
    el.title = title;
    if (dataset) Object.entries(dataset).forEach(([k, v]) => { el.dataset[k] = v; });
    el.textContent = text;
    return el;
};

const render = () => {
    const columnsLength = columnData.length;
    const frag = document.createDocumentFragment();

    columnData.forEach((col, i) => {
        const headerEl = makeAbbr(
            col.label,
            ['header', `col-${i % 2 ? 'odd' : 'even'}`, `col-${i}`],
            col.label,
            { idx: String(i) },
        );
        if (col.selected) headerEl.classList.add('selected');
        frag.appendChild(headerEl);
    });

    finalData.flat().forEach((value, i) => {
        const colIdx = i % columnsLength;
        const text = value == null ? '' : String(value);
        const cellEl = makeAbbr(
            text,
            [
                `row-${Math.floor(i / columnsLength) % 2 ? 'odd' : 'even'}`,
                `col-${colIdx % 2 ? 'odd' : 'even'}`,
                `col-${colIdx}`,
            ],
            text,
        );
        if (columnData[colIdx]?.selected) cellEl.classList.add('selected');
        frag.appendChild(cellEl);
    });

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
    RecoderLib.applyRecode(finalData, rawData, colIndices, transformations);

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
    const { headers, rows } = RecoderLib.parseSheetData(worksheet);
    rawData.splice(0, rawData.length);
    rawData.push(...RecoderLib.cookRows(rows));
    finalData.splice(0, finalData.length);
    finalData.push(...rows);
    columnData.splice(0, columnData.length);
    columnData.push(...RecoderLib.buildColumnData(headers, rawData));

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

const readExistingCodes = () => {
    const map = new Map();
    transformationsForm.querySelectorAll('input[type="number"]').forEach(input => {
        map.set(input.getAttribute('name'), input.value);
    });
    return map;
};

const buildTransformationsFragment = (items, selectedIndices) => {
    const frag = document.createDocumentFragment();
    items.forEach(({ key, label, code }) => {
        const wrapper = document.createElement('div');
        const input = document.createElement('input');
        input.type = 'number';
        input.value = code;
        input.name = key;
        const labelEl = document.createElement('label');
        labelEl.textContent = label;
        wrapper.appendChild(input);
        wrapper.appendChild(labelEl);
        frag.appendChild(wrapper);
    });
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = 'cols';
    hidden.value = selectedIndices.join(',');
    frag.appendChild(hidden);
    return frag;
};

const buildSelectedColsFragment = selectedCols => {
    const frag = document.createDocumentFragment();
    selectedCols.forEach(col => {
        const a = document.createElement('a');
        a.textContent = col.label;
        frag.appendChild(a);
    });
    return frag;
};

const updateSelections = () => {
    const selectedCols = columnData.filter(col => col.selected);
    const hasSelections = selectedCols.length !== 0;
    excelDiv.classList.toggle('no-selections', !hasSelections);
    excelDiv.classList.toggle('has-selections', hasSelections);

    if (!hasSelections) {
        if (updateSelectionsFrame) cancelAnimationFrame(updateSelectionsFrame);
        updateSelectionsFrame = requestAnimationFrame(() => {
            selectedColumnsList.replaceChildren();
            transformationsForm.replaceChildren();
        });
        return;
    }

    const selectedIndices = selectedCols.map(col => col.idx);
    const values = RecoderLib.collectValuesForSelection(columnData, selectedIndices);
    const items = RecoderLib.generateTransformationItems(values, readExistingCodes());

    const newForm = buildTransformationsFragment(items, selectedIndices);
    const newCols = buildSelectedColsFragment(selectedCols);

    if (updateSelectionsFrame) cancelAnimationFrame(updateSelectionsFrame);
    updateSelectionsFrame = requestAnimationFrame(() => {
        selectedColumnsList.replaceChildren(newCols);
        const current = transformationsForm.childNodes;
        const incoming = Array.from(newForm.childNodes);
        const same = incoming.length === current.length
            && incoming.every((child, i) => child.isEqualNode(current[i]));
        if (!same) transformationsForm.replaceChildren(newForm);
    });
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
    selectedColumnsList.replaceChildren();
    transformationsForm.replaceChildren();
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
        data.set(el.getAttribute('name'), el.value);
    });

    const cols = transformationsForm.querySelector('input[name="cols"]').value;

    recode(cols, data);
});

document.querySelector('#download').addEventListener('click', e => {
    e.preventDefault();
    RecoderLib.writeFinalDataToWorksheet(worksheet, finalData);

    XLSX.writeFile(workbook, filename.replace(/\.[^.]*$/, '') + '-recoded.xlsx', { compression: true, type: 'xlsx' });
});