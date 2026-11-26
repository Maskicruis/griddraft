# Project-specific requirements

## Substation network baseline

The user's authoritative reference for all future default substation networks is
`00126.xlsx` (Sheet1, A1:F192; 191 records). The verified local source is
`E:/中车扶余数字孪生/00126.xlsx`, SHA-256
`a6db118dfb42023d4cc709f2488543c8e7f115ec2dc9374941e16ce823cea2db`.
Use the workbook's work breakdown, procedure names, durations in working days,
and planned dates. Do not silently replace these with the old seven-step,
one-day placeholder substation skeleton or invented durations. Keep project
adjustments distinct from the source baseline.

The user explicitly confirmed that predecessor/successor numbers are IDs from
the original scheduling software, NOT Excel row numbers. The supplied export
does not contain a work-ID column. Some relationship text is incomplete.
Do not guess the ID-to-row mapping, infer missing links from dates, or claim
that a verified default dependency network has been restored. Obtain a complete
ID mapping and untruncated dependency text before activating this baseline as
an automatically calculated default. Keep summary rows distinct from work
activities to avoid double-counting durations. Preserve SS/FS relationship
types and working-day/calendar semantics rather than silently converting all
links to zero-lag FS links.

The unchanged source and extracted reference catalog remain local; publishing
the source workbook was not requested. See `docs/substation-baseline.md` for
implementation status and the local baseline files.
