// Regenerates the binary XLSX fixtures used by the test suite. Run with
// `node tests/fixtures/generate.mjs`. The fixtures are committed to the
// repo so test runs don't need to regenerate them.
//
// Each fixture mimics a real survey-data shape that the recoder is meant
// to handle. If you change a fixture's shape, also update the matching
// expectation in tests/unit/recoder.fixtures.test.js.

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(here, { recursive: true });

function write(name, workbook) {
    const buf = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    writeFileSync(join(here, name), buf);
}

// 1. Classic Likert-scale survey: 5 questions, 200 respondents.
//    Real-world shape: text answers with consistent vocabulary.
{
    const choices = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];
    const headers = ['RespondentID', 'Q1: Tool is useful', 'Q2: Easy to learn', 'Q3: Would recommend', 'Q4: Met expectations', 'Q5: Will use again'];
    const aoa = [headers];
    let seed = 1;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 1; i <= 200; i++) {
        aoa.push([`R${i.toString().padStart(4, '0')}`,
            choices[Math.floor(rand() * choices.length)],
            choices[Math.floor(rand() * choices.length)],
            choices[Math.floor(rand() * choices.length)],
            choices[Math.floor(rand() * choices.length)],
            choices[Math.floor(rand() * choices.length)],
        ]);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Responses');
    write('likert-survey.xlsx', wb);
}

// 2. Multi-sheet workbook. The app reads only the first sheet, so the
//    "ignored" sheets should not affect any output.
{
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['Color', 'Size'],
        ['red', 'S'],
        ['blue', 'M'],
        ['green', 'L'],
    ]), 'PrimaryData');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['CodeBook'],
        ['red=1, blue=2, green=3'],
    ]), 'Notes');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['Should never appear', 'in the recoded preview'],
        ['ignored', 'ignored'],
    ]), 'IGNORED');
    write('multi-sheet.xlsx', wb);
}

// 3. Workbook with merged cells in the header (a common "pretty" survey
//    export shape). Merged cells should not crash the parser.
{
    const ws = XLSX.utils.aoa_to_sheet([
        ['Category', '', 'Response'],
        ['A', 'B', 'agree'],
        ['A', 'B', 'disagree'],
        ['A', 'B', 'agree'],
    ]);
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    write('merged-header.xlsx', wb);
}

// 4. Workbook containing formula cells. Excel evaluates formulas; the
//    recoder should see the cached formatted result, not the raw "=…".
{
    const ws = XLSX.utils.aoa_to_sheet([
        ['A', 'B', 'Sum'],
        [1, 2, null],
        [3, 4, null],
    ]);
    // Formula cells with both .f (formula) and .v (cached result).
    ws['C2'] = { t: 'n', f: 'A2+B2', v: 3, w: '3' };
    ws['C3'] = { t: 'n', f: 'A3+B3', v: 7, w: '7' };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    write('formulas.xlsx', wb);
}

// 5. Large workbook: 1000 rows × 8 columns of mixed Likert + categorical
//    + numeric data. Performance budgets reference this fixture.
{
    const headers = ['RespondentID', 'Q1', 'Q2', 'Q3', 'Q4', 'AgeGroup', 'Region', 'Score'];
    const likert = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];
    const ages = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
    const regions = ['North', 'South', 'East', 'West', 'Central'];
    const aoa = [headers];
    let seed = 42;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 1; i <= 1000; i++) {
        aoa.push([`R${i.toString().padStart(5, '0')}`,
            likert[Math.floor(rand() * likert.length)],
            likert[Math.floor(rand() * likert.length)],
            likert[Math.floor(rand() * likert.length)],
            likert[Math.floor(rand() * likert.length)],
            ages[Math.floor(rand() * ages.length)],
            regions[Math.floor(rand() * regions.length)],
            Math.floor(rand() * 100),
        ]);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Responses');
    write('large-1000-rows.xlsx', wb);
}

// 6. Workbook with mixed types in the same column (a common dirty-data
//    case where respondents type free-form values).
{
    const ws = XLSX.utils.aoa_to_sheet([
        ['Age'],
        [25],
        ['twenty-six'],
        [27.5],
        ['unknown'],
        [true],
        [''],
        ['25 '],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    write('mixed-types.xlsx', wb);
}

// 7. International characters: emoji, RTL, combining marks.
{
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['City'],
        ['İstanbul'],
        ['Köln'],
        ['北京'],
        ['القاهرة'],
        ['São Paulo'],
        ['🍎🍊🍋'],
        ['Café'],
        ['Cafe\u0301'],
    ]), 'Sheet1');
    write('international.xlsx', wb);
}

console.log('fixtures regenerated in', here);
