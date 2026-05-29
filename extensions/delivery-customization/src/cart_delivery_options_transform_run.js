// @ts-check

/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").CartDeliveryOptionsTransformRunResult} CartDeliveryOptionsTransformRunResult
 * @typedef {import("../generated/api").Operation} Operation
 */

/** @type {CartDeliveryOptionsTransformRunResult} */
const NO_CHANGES = {
  operations: [],
};

/**
 * Entry point for cart.delivery-options.transform.run
 *
 * @param {RunInput} input
 * @returns {CartDeliveryOptionsTransformRunResult}
 */
export function cartDeliveryOptionsTransformRun(input) {
  /** @type {Operation[]} */
  const operations = [];

  // --- Parse group data exactly like old code ------------------------------

  const allowedZipcodesGroups = (
    input.localization.market.allowedZipcodes?.value || ""
  )
    .split("@@")
    .map((group) => group.split("|").filter(Boolean));

  const deliveryAvailableTimeGroups = (
    input.localization.market.deliveryAvailableTime?.value || ""
  )
    .split("@@")
    .map((group) => group || "");

  const deliveryUnavailableDaysGroups = (
    input.localization.market.deliveryUnavailableDays?.value || ""
  )
    .split("@@")
    .map((group) => {
      if (!group) return [];
      return group.split("|").filter(Boolean);
    });

  const cartLines = input?.cart?.lines || [];
  const has2hrDeliveryTag = cartLines.some(
    (line) => line?.merchandise?.product?.hasAnyTag === true,
  );

  const deliveryGroup = input?.cart?.deliveryGroups?.[0];
  const deliveryOptions = deliveryGroup?.deliveryOptions || [];
  const deliveryZip = deliveryGroup?.deliveryAddress?.zip || "";

  // --- Helper: hide "2hr Delivery" option (operation shape updated) -------

  /**
   * Hide any delivery option whose title is exactly "2hr Delivery".
   *
   * @returns {CartDeliveryOptionsTransformRunResult | undefined}
   */
  function hide2hrDeliveryOption() {
    if (!Array.isArray(deliveryOptions) || deliveryOptions.length === 0) {
      return;
    }

    deliveryOptions.forEach((deliveryOption) => {
      const { title, handle } = deliveryOption;
      if (title === "2hr Delivery") {
        operations.push({
          deliveryOptionHide: {
            deliveryOptionHandle: handle,
          },
        });
      }
    });

    if (operations.length > 0) {
      return { operations };
    }
  }

  // Agar options ya zip missing hai, to simple hide
  if (!deliveryOptions.length || !deliveryZip) {
    return hide2hrDeliveryOption() || NO_CHANGES;
  }

  // --- Time calculations (old behaviour) -----------------------------------

  const orderTimestamp = Number(input?.cart?.orderTimestamp?.value);
  const orderTime = new Date(orderTimestamp);

  /**
   * Old convertToTimestamp logic:
   * - "2026-04-25T07:00:00" → Date.parse as-is
   * - "09:00:00"            → orderTime.toDateString() + " 09:00:00"
   */
  const convertToTimestamp = (timeOrDateStr, orderTimeParam) => {
    if (!timeOrDateStr) return 0;

    // Full ISO datetime string
    if (timeOrDateStr.includes("T")) {
      return Date.parse(timeOrDateStr);
    }

    // Time-only string, combine with order's local date
    if (timeOrDateStr.includes(":") && orderTimeParam) {
      const orderDateStr = orderTimeParam.toDateString();
      const combinedDateTimeStr = `${orderDateStr} ${timeOrDateStr}`;
      return Date.parse(combinedDateTimeStr);
    }

    throw new Error("Invalid input format.");
  };

  /**
   * Old parseDeliverySchedule logic, unchanged
   * Supports:
   * - "MON:09:00:00/17:00:00|TUE:10:00:00/18:00:00|...|SUN:closed"
   * - "09:00:00/20:00:00"
   * - "closed"
   */
  const parseDeliverySchedule = (scheduleStr) => {
    if (!scheduleStr) return {};

    // New day-specific format
    if (/(MON|TUE|WED|THU|FRI|SAT|SUN):/.test(scheduleStr)) {
      const schedule = {};
      const dayEntries = scheduleStr.split("|");

      dayEntries.forEach((entry) => {
        const colonIndex = entry.indexOf(":");
        if (colonIndex === -1) return;

        const day = entry.substring(0, colonIndex).toUpperCase();
        const timeRange = entry.substring(colonIndex + 1);

        if (timeRange.toLowerCase() === "closed") {
          schedule[day] = null;
        } else if (timeRange.includes("/")) {
          const [start, end] = timeRange.split("/");
          schedule[day] = { start: start.trim(), end: end.trim() };
        }
      });

      return schedule;
    }

    // Legacy format
    const trimmedSchedule = scheduleStr.trim().toLowerCase();

    if (trimmedSchedule === "closed") {
      return {
        MON: null,
        TUE: null,
        WED: null,
        THU: null,
        FRI: null,
        SAT: null,
        SUN: null,
      };
    }

    if (scheduleStr.includes("/")) {
      const [start, end] = scheduleStr.split("/");
      const timeRange = { start: start.trim(), end: end.trim() };
      return {
        MON: timeRange,
        TUE: timeRange,
        WED: timeRange,
        THU: timeRange,
        FRI: timeRange,
        SAT: timeRange,
        SUN: timeRange,
      };
    }

    return {};
  };

  /**
   * Old checkDaySpecificAvailability logic:
   * - Uses local getDay() (0 = Sunday ... 6 = Saturday)
   * - Compares orderTime.getTime() inside start/end
   */
  const checkDaySpecificAvailability = (schedule, orderTimeParam) => {
    const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const currentDay = dayNames[orderTimeParam.getDay()];

    const daySchedule = schedule[currentDay];
    if (!daySchedule) return false; // Closed that day

    try {
      const deliveryStartTimestamp = convertToTimestamp(
        daySchedule.start,
        orderTimeParam,
      );
      const deliveryEndTimestamp = convertToTimestamp(
        daySchedule.end,
        orderTimeParam,
      );
      const nowTs = orderTimeParam.getTime();

      return deliveryStartTimestamp < nowTs && nowTs < deliveryEndTimestamp;
    } catch {
      return false;
    }
  };

  /**
   * Old checkDeliveryUnavailableDays logic:
   * - unavailableDay: "2026-04-25T07:00/2026-04-25T23:01"
   * - convertToTimestamp called without orderTime for these → ISO parse
   */
  const checkDeliveryUnavailableDays = (unavailableDays, orderTimestampParam) => {
    return unavailableDays.some((unavailableDay) => {
      const [unavailableFrom, unavailableTo] = unavailableDay.split("/");
      const unavailableFromTimestamp = convertToTimestamp(unavailableFrom);
      const unavailableToTimestamp = convertToTimestamp(unavailableTo);
      return (
        unavailableFromTimestamp < orderTimestampParam &&
        orderTimestampParam < unavailableToTimestamp
      );
    });
  };

  // --- Business rules (same as old) ---------------------------------------

  // 1. If no product has 2hr tag, hide option
  if (!has2hrDeliveryTag) {
    return hide2hrDeliveryOption() || NO_CHANGES;
  }

  // 2. Find which group the zip code belongs to
  let zipGroupIndex = -1;
  for (let i = 0; i < allowedZipcodesGroups.length; i++) {
    if (allowedZipcodesGroups[i].includes(deliveryZip)) {
      zipGroupIndex = i;
      break;
    }
  }

  // 3. If zip code doesn't match any group, hide 2hr
  if (zipGroupIndex === -1) {
    return hide2hrDeliveryOption() || NO_CHANGES;
  }

  // 4. Load constraints for that group
  const deliveryAvailableTimeStr =
    deliveryAvailableTimeGroups[zipGroupIndex] || "";
  const deliveryUnavailableDays =
    deliveryUnavailableDaysGroups[zipGroupIndex] || [];

  const deliverySchedule = parseDeliverySchedule(deliveryAvailableTimeStr);
  const deliveryAvailable = checkDaySpecificAvailability(
    deliverySchedule,
    orderTime,
  );

  const deliveryUnavailableDay =
    deliveryUnavailableDays.length !== 0 &&
    checkDeliveryUnavailableDays(deliveryUnavailableDays, orderTimestamp);

  // 5. If time window not valid OR falls in unavailable days, hide 2hr
  if (!deliveryAvailable || deliveryUnavailableDay) {
    const result = hide2hrDeliveryOption();
    if (result) return result;
  }

  // 6. Else, leave options unchanged
  return NO_CHANGES;
}