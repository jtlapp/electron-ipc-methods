import { reportErrorsToMain, windowFinished } from "../lib/renderer_util";
import { ACCEPTABLE_DELAY_MILLIS } from "../lib/config";
import { sleep } from "../lib/shared_util";
import { callMainApi2 } from "./call_main_api_2";

(async () => {
  try {
    reportErrorsToMain("win2");
    await sleep(ACCEPTABLE_DELAY_MILLIS * 1.2);
    await callMainApi2("win2");
    windowFinished();
  } catch (err) {
    window.ipc.send("test_aborted", err);
  }
})();