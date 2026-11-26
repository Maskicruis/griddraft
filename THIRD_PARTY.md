# Third-party materials

- ELK.js 0.12.1 provides layered layout and orthogonal routing. See the included license files in node_modules/elkjs and the upstream project https://github.com/kieler/elkjs.
- Electron provides the desktop runtime. Its bundled distribution includes Electron and Chromium license notices.
- The desktop planning agent uses the official MIT-licensed DeepSeek Harness agent loop and adapters from dsh-v0.2.2-rc.3. See https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.3 and the notices distributed with its packages.
- The Windows command-line ZIP bundles Node.js 24.16.0. See LICENSE.node.txt in that package and https://nodejs.org/.
- The structure of the optional timeline and editor interactions were studied at https://github.com/lee576/vue3-gantt/tree/ea00cb9fd2509a0c5e2620276ce2fc8ca4d68c55. GridDraft implements these interactions in its own code.
- ExcelJS 4.4.0 and JSZip 3.10.2 provide local XLSX reading and SpreadsheetML namespace compatibility normalization. Both are MIT licensed; see https://github.com/exceljs/exceljs/tree/v4.4.0 and https://github.com/Stuk/jszip. Their license files are included with their packages. ExcelJS's UUID dependency is pinned to 11.1.1 via an override.
- Connection-flow presentation was studied at https://github.com/tt-a1i/archify/tree/v3.3.0. GridDraft implements its own SVG flow overlay, pause control and reduced-motion behavior. No Archify runtime or DSH plugin is installed or bundled.
