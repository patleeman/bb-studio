# Simulated table loading and recovery

The 5,000-row fixture loads and reaches its final row under both tested network profiles. The baseline exposed a missing Retry action after initial-load failure. The published fix now clears the error, shows loading and recovers row 5,000 from a native Retry click under the slower simulated profile.

## Verified source and scope

The staged plugin registry identifies Tables at `c2bc4da`; its cached Git checkout resolves to `c2bc4da5c2019fee6704b891a9d11e5ad954d472`. The verifier asserts that identity and records the active artifact hash in [verification.json](verification.json). The workspace panel source also matches that commit.

`scripts/capture/verify-table-latency.mjs` owns a fresh headless Chrome process and profile on port 49569. It uses only staged BB at port 49486 and creates a dedicated 5,000-row table. CDP network emulation changes only that browser session. It does not change the machine network, server, plugin settings or other fixtures.

The application shell and plugin code load before measurement. Each sample closes and opens a fresh table editor through in-document history navigation. The document token and `performance.timeOrigin` remain unchanged. Readiness waits for the first mounted cell, then two animation frames. The driver's fixed navigation delay is outside measurement.

## Fixture observations

Bandwidth values are converted to CDP bytes/second. The 1.5Mbps profile uses 187,500 bytes/second download and 46,875 upload. The 512Kbps profile uses 64,000 download and 16,000 upload. Latency is the configured CDP value; it is not an independently measured WAN round-trip time.

| Browser network profile | Table request | Editor ready | Loading state observed |
| --- | ---: | ---: | --- |
| Local control, unthrottled | 22ms | 137ms | Yes |
| 150ms latency, 1.5Mbps down / 375Kbps up | 662ms | 749ms | Yes |
| 400ms latency, 512Kbps down / 128Kbps up | 1,963ms | 2,044ms | Yes |

Each table response returns all 5,000 rows: CDP reports 76,078 encoded bytes, and the decoded JSON measures 668,240 bytes. The first mounted view is ready only after that full response. Windowing bounds mounted rows; it does not paginate server data or reduce the complete table transfer.

In all three profiles, Ctrl+End reaches the visible final quantity cell (`4,999`), with fewer than 80 rows mounted. [The slow-profile capture](400ms-512Kbps.png) shows row 5,000 after loading.

## Failure and recovery

The failure phase blocks only `/api/v1/plugins/studio-tables/rpc/get` inside the owned Chrome session. The table shows an accessible alert, “Failed to fetch,” and no grid. [The failed-load capture](failed-load.png) shows only the Back to Studio action.

After the block is cleared, a 6-second observation finds no new table request, the same error and no Retry or Try again button. The source's error branch in `packages/bb-studio/src/modules/tables/src/panel.tsx` provides only the back header. Its load effect retries only when the RPC object, table ID or version changes.

Leaving and reopening the table clears the error and loads successfully in 143ms in this local fixture run. Ctrl+End again reaches row 5,000. [The recovered-load capture](recovered-load.png) records the final row.

## Packaged Retry fix

The final after-mode run verifies exact staged commit `6dbab45e32fd5bc0c04ee78770a2cb1eca990467` through the plugin registry and cached Git checkout. [After measurements](after/verification.json) preserve the source and active artifact hash. The fix belongs to the Tables panel; this verifier did not change production source.

The same blocked initial request now shows an alert and [Retry button](after/failed-load.png). After restoring the endpoint, the alert remains until the user chooses Retry. A native mouse click under 400ms simulated latency and 512Kbps download clears that alert, shows the accessible [Loading table status](after/retry-loading.png), and issues exactly one successful fresh table request. The editor becomes ready in about 1.75 seconds in this run. Ctrl+End reaches the visible final cell with only 37 rows mounted; [the recovery capture](after/retry-recovered.png) shows row 5,000.

The final three profile observations are 146ms ready for local control, 718ms for the 150ms/1.5Mbps profile, and 2,040ms for the 400ms/512Kbps profile. Each response still returns 5,000 rows, with 75,988 CDP encoded bytes and 668,240 decoded JSON bytes. These observations retain the full-data-loading boundary; the Retry change does not add server paging.

The root verification run reports Tables' 13 tests, typecheck, build and the full repository check passing. This lane verifies the packaged browser path, including the failure, loading and recovery screenshots.

## Limits and cleanup

These are simulated conditions against a local staged server on a shared development host. There is one sample per profile, with no claim about actual remote servers, mobile radios, physical devices, VPNs, packet loss, thermal behavior or battery use. The warm shell excludes cold application download/startup. The failure phase tests initial table loading; it does not test offline writes, durable queues or edit conflicts.

The script clears browser emulation and request blocking, removes its table, closes its browser and removes its profile in `finally`. A final staged RPC check finds zero latency fixtures, and port 49569 is closed.

```sh
source /tmp/bb-studio-goal-staged/capture.env
export BB_CAPTURE_CDP_PORT=49569
node scripts/capture/verify-table-latency.mjs
```

After installing the exact Retry commit in staged BB, run the strict after-mode proof:

```sh
source /tmp/bb-studio-goal-staged/capture.env
export BB_CAPTURE_CDP_PORT=49569
export BB_TABLE_LATENCY_SOURCE=6dbab45e32fd5bc0c04ee78770a2cb1eca990467
export BB_TABLE_LATENCY_EXPECT_RETRY=1
node scripts/capture/verify-table-latency.mjs
```
