# Controller Profiles

SPATT's timing model is deliberately general: up to 16 phases in up to 4 rings, editable
sequences and barriers, and an explicit offset reference on every pattern. Real controllers
support less than that, and each numbers and stores things its own way.

A **controller profile** bridges the two. For one controller it:

- checks a SPATT intersection against what the controller can express, and reports each thing
  that would not survive export;
- converts a plan to the controller's own format, including units, rounding and offset
  reference;
- reads the controller's format back into SPATT.

Profiles:

- [CSM ASC-3](csm-asc3.md): the ASC-3 style controller in the City Super Mod.
