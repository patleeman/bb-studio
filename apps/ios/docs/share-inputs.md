# Share input recovery and image bounds

Share reads every supplied item before enabling Send. A failed, unreadable or
unsupported attachment stays visible as an error; it cannot silently disappear
from an otherwise successful message. The owner can close Share and try again.
The original source files are never modified.

Photos are downsampled to at most 2,048 actual pixels on either edge, then
encoded as JPEG. ImageIO handles file/data sources without first rendering a
full-resolution image. UIImage sources retain their pixel scale when calculating
the target size; the output renderer explicitly uses scale 1. A regression on
the iPhone simulator reproduced the previous 6,144 × 3,072 output for an intended
2,048 × 1,024 photo when the renderer inherited the screen's 3× scale.

Files over 35 MiB are rejected before their bytes are allocated, then checked
again after reading. Security-scoped access lasts through the read. Shared text
accepts String and UTF-8/UTF-16 byte representations: a real NSString item
provider exposed the previous assumption that every text item was a String.

Five `ShareFileTests` exercise real image encoding, both ordinary and Retina
UIImage sources, file-size rejection, unavailable files, invalid image data,
mixed valid text/failed attachments, and UTF-16 providers. The final isolated
native suite passed **76 tests with one existing skip and no failures**, and the
app, Share extension, widgets and Watch targets built. The unit test script sets
the private simulator's app and shared preference domains to an unavailable
loopback origin before launch, preventing background requests to a saved user
server. Use a private empty simulator, not a copy of the user's device.

This verifies the Share data path and extension build. It does not establish
system share-sheet presentation, physical-device extension memory limits,
provider-specific cloud-file behavior, or a real end-to-end send from another
app. Those remain separate runtime checks.

The subsequent [Share runtime verification](share-runtime/README.md) exercised
actual extension registration and presentation through the iOS system share
sheet in a separate fixture app. Four presentation checks passed, followed by
one real file Send into a newly created staged QA project. It also added
accessible descriptions for image and file previews. Physical-device memory
limits and provider-specific cloud files remain outside that simulator proof.
