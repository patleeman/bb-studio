# Desktop control: bundled third-party software

BB Studio's desktop control runs `cua-driver`, the Cua Driver daemon, as a
helper inside the app (`Contents/Resources/desktop-control/cua-driver`). It is
an unmodified build of Cua Driver, pinned in
`apps/desktop/desktop-control.fork.json`:

- Cua Driver 0.47.24, https://github.com/trycua/cua (`libs/cua-driver`),
  tag `cua-driver-rs-v0.47.24`, commit `b168ff39fef15d993ab66facce9b0027ea556dce`.
- It runs embedded, with telemetry and update checks off
  (`DO_NOT_TRACK=1`, `CUA_DRIVER_RS_TELEMETRY_ENABLED=0`,
  `CUA_DRIVER_RS_UPDATE_CHECK=0`).

## Cua Driver

MIT License

Copyright (c) 2025 Cua AI, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Work included in Cua Driver

From Cua Driver's `libs/cua-driver/rust/THIRD_PARTY_NOTICES.md` at the pinned
commit. Each project is MIT-licensed; the license text is the one above, with
each project's own copyright line.

| Project | Copyright | Used for |
| --- | --- | --- |
| trope-cua, https://github.com/voctory/trope-cua | Copyright (c) 2026 Victor Vannara | Windows cursor overlay and background input; cursor motion details |
| Interface-Agent, https://github.com/francedot/Interface-Agent | Copyright (c) 2024 Francesco Bonacci | Windows UI Automation tree walk and element actions |
| yabai, https://github.com/koekeishiya/yabai | Copyright (c) 2019 Åsmund Vikane | The macOS focus-without-raise event sequence |
| QuickJS-ng, https://github.com/quickjs-ng/quickjs | Copyright (c) 2017-2026 Fabrice Bellard; (c) 2017-2024 Charlie Gordon; (c) 2023-2026 Ben Noordhuis; (c) 2023-2026 Saúl Ibarra Corretgé | The JavaScript engine behind the driver's `run_script` tool |
| rquickjs, https://github.com/DelSkayn/rquickjs | Copyright (c) 2020 Mees Delzenne; (c) 2025 Rquickjs Contributors | Rust bindings to QuickJS-ng |
| T3 Code, https://github.com/pingdotgg/t3code | Copyright (c) 2026 T3 Tools Inc. | Linux fixes ported into the driver |

## BB Studio's own helper

`bb-studio-desktop-helper` (permissions, the talk key, what is under the
pointer) is BB Studio's own code, built from
`apps/desktop/native/fork-desktop-helper/main.swift`, under BB Studio's license.
