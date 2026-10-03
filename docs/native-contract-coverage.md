# Native plugin contract coverage

`pnpm gen:contracts` generates JSON schemas and Swift models from each included
plugin's actual RPC contract. Feed is included alongside Studio, Pages, Draw,
Talk, Tasks, Chat, Teams, Tables, Artifacts, Mobile and Decisions.

`pnpm check:contracts` also checks the generated
[native RPC inventory](../contracts/native-rpc-inventory.json). It scans the
app, shared code, Share extension, widgets and Watch for plugin RPC calls.
Literal method names used against repository plugins must exist in that
plugin's contract. Generated method names must use the correct namespace.
Unknown repository endpoints fail the check, rather than silently entering
the inventory as external APIs.

The inventory separates generated method references, checked literal names,
external host plugins and dynamic dispatch. It checks method parity; it does
not prove handwritten request and response shapes. Native transport/decoder
tests cover those behaviors. Feed preserves its older-server read-state
default and tolerant priority decoding while using generated method names.

The first inventory found a real drift: native Studio Chat called the removed
`lastThread` method. It now calls `home` and reads `thread.threadId`, with a
transport regression for linked and unlinked items.

Remaining boundaries: host-bundled plugins such as Automations, push
notifications, concurrency controls and the native thread list are maintained
outside this repository. Their runtime compatibility still needs integration
verification. Generated Swift models intentionally accept missing fields for
older installations; model generation alone is not strict wire validation.
