# Forms Recoder

A tiny browser tool for researchers who collect data through online forms
(Google Forms, Microsoft Forms, Qualtrics, SurveyMonkey, REDCap, etc.)
and need to convert the text answers into numeric codes before running
statistical analysis.

Live at: <https://recoder.barahmand.com>

## Why this exists

Survey and form platforms export responses as Excel files full of human
labels — `"Strongly agree"`, `"Agree"`, `"Neutral"`, `"Disagree"`,
`"Strongly disagree"` in a Likert column; `"Male"`/`"Female"`/`"Non-binary"`
in a demographics column; `"Yes"`/`"No"` in a screener column.

Statistical packages (SPSS, R, Stata, SAS, JASP, Python + `pandas`/
`statsmodels`) want **numbers**: `1, 2, 3, 4, 5`. Recoding 30 columns of
text answers by hand in Excel — with `IF` ladders, `VLOOKUP` tables, or
copy-pasted find-and-replace — is slow, error-prone, and easy to do
inconsistently across columns.

Forms Recoder does the boring part:

1. Drag in the Excel file your form platform spat out.
2. Click the columns you want to recode (multi-select to share a code
   scheme across columns — e.g. all five Likert items at once).
3. Accept the auto-generated `1..N` codes, or type the numbers you
   want (so the codes match your codebook / a previous wave of data).
4. Click Apply, then Download. You get an `.xlsx` with the same shape
   and the same headers, but the recoded columns now contain numbers
   ready to load into your analysis tool.

Everything happens in the browser. No upload, no server, no account —
the file never leaves your machine, which matters when you're handling
human-subjects data (IRB / GDPR / HIPAA contexts).

## Use it

Open <https://recoder.barahmand.com> and follow the on-screen steps.
There is no install, no signup. Bring your own `.xlsx`.

## Scope (what this is and isn't)

**Is:**

- A point-and-click recoder for the most common case: turning a
  closed-ended text response into a numeric code, one column at a
  time or across a group of columns sharing the same scheme.
- 100% client-side — useful for IRB / GDPR / HIPAA-adjacent contexts
  where uploading raw response data to a third-party server is
  unacceptable.

**Isn't:**

- A statistics tool. It produces numbers; *what you do with them* is
  on you.
- A data-cleaning tool. It does not handle skip logic, missing-value
  conventions (`-99`, `NA`), reverse-scoring, scale construction,
  free-text coding, or de-duplication.
- A codebook manager. Codes you assign during a session are not saved
  between sessions; if you need a stable codebook across waves, type
  the same numbers each time (or save your codebook somewhere else and
  re-enter it).

## Contributing / development

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for setup, tests, build, and
deploy. See [`AGENTS.md`](AGENTS.md) for test conventions.

## License

MIT — see [`LICENSE`](LICENSE).
