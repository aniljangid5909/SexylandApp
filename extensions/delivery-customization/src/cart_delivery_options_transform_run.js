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
 * Logic:
 * - Sirf un carts ke liye 2hr Delivery allow jahan:
 *   - kam se kam ek product me "2hr Delivery" ya "Quickie" tag ho
 *   - delivery zip allowed zip group me ho
 *   - current order time (Order-Timestamp) allowed time window me ho
 *   - order kisi unavailable window (deliveryUnavailableDays) ke andar na ho
 *
 * @param {RunInput} input
 * @returns {CartDeliveryOptionsTransformRunResult}
 */
export function cartDeliveryOptionsTransformRun(input) {
  /** @type {Operation[]} */
  const operations = [];

  const market = input.localization?.market;
  const cart = input.cart;

  // --- Parse market metafields into grouped configs ------------------------

  const allowedZipcodesRaw = market?.allowedZipcodes?.value ?? "";
  const deliveryAvailableTimeRaw = market?.deliveryAvailableTime?.value ?? "";
  const deliveryUnavailableDaysRaw =
    market?.deliveryUnavailableDays?.value ?? "";

  // allowedZipcodes: "10001|10002@@20001|20002"
  const allowedZipcodesGroups = allowedZipcodesRaw
    .split("@@")
    .map((group) => group.split("|").filter(Boolean));

  // deliveryAvailableTime:
  //   - "MON:09:00/17:00|TUE:10:00/18:00|..." (per day) OR
  //   - "08:00:00/23:00:00" (same window every day)
  const deliveryAvailableTimeGroups = deliveryAvailableTimeRaw
    .split("@@")
    .map((group) => group || "");

  // deliveryUnavailableDays:
  //   - Each group: "2025-07-01T00:00/2025-07-02T00:00|2025-12-24T00:00/..."
  const deliveryUnavailableDaysGroups = deliveryUnavailableDaysRaw
    .split("@@")
    .map((group) => {
      if (!group) return [];
      return group.split("|").filter(Boolean);
    });

  // --- Basic cart info -----------------------------------------------------

  const cartLines = cart?.lines ?? [];
  const deliveryGroup = cart?.deliveryGroups?.[0];
  const deliveryOptions = deliveryGroup?.deliveryOptions ?? [];
  const deliveryZip = deliveryGroup?.deliveryAddress?.zip ?? "";

  const has2hrDeliveryTag = cartLines.some((line) => {
    const product = line?.merchandise?.product;
    return product?.hasAnyTag === true;
  });

  // --- Helper to hide the "2hr Delivery" option ---------------------------

  /**
   * Hide any delivery option whose title is exactly "2hr Delivery".
   *
   * @returns {CartDeliveryOptionsTransformRunResult}
   */
  function hide2hrDeliveryOption() {
    if (!Array.isArray(deliveryOptions) || deliveryOptions.length === 0) {
      return NO_CHANGES;
    }

    for (const deliveryOption of deliveryOptions) {
      if (deliveryOption.title === "2hr Delivery") {
        operations.push({
          deliveryOptionHide: {
            deliveryOptionHandle: deliveryOption.handle,
          },
        });
      }
    }

    if (operations.length === 0) {
      return NO_CHANGES;
    }

    return { operations };
  }

  // If we don't have options or a zip code, there's no way to validate;
  // just hide the 2hr option if it exists.
  if (!deliveryOptions.length || !deliveryZip) {
    return hide2hrDeliveryOption();
  }

  // --- Time utilities (UTC‑safe) ------------------------------------------

  const orderTimestamp = Number(cart?.orderTimestamp?.value);
  const orderTime = new Date(orderTimestamp);

  /**
   * Convert a time or ISO string to a UTC timestamp (ms since epoch).
   *
   * - If it contains "T": treat as full ISO datetime and parse directly.
   * - If it contains ":" but no date: combine with the order date (UTC year/month/day).
   *
   * @param {string} timeOrDateStr
   * @param {Date} [orderDate]
   * @returns {number}
   */
  const convertToTimestamp = (timeOrDateStr, orderDate) => {
    if (!timeOrDateStr) return 0;

    // Full ISO datetime string (e.g., "2025-07-01T09:00:00Z")
    if (timeOrDateStr.includes("T")) {
      return Date.parse(timeOrDateStr);
    }

    // Time only: "HH:MM" or "HH:MM:SS"
    if (timeOrDateStr.includes(":") && orderDate) {
      const year = orderDate.getUTCFullYear();
      const month = orderDate.getUTCMonth(); // 0–11
      const day = orderDate.getUTCDate(); // 1–31

      const parts = timeOrDateStr.split(":").map((p) => parseInt(p, 10));
      const hours = parts[0] || 0;
      const minutes = parts[1] || 0;
      const seconds = parts[2] || 0;

      // Build timestamp in UTC
      return Date.UTC(year, month, day, hours, minutes, seconds);
    }

    throw new Error("Invalid input format for delivery time.");
  };

  /**
   * Parse delivery schedule string into a per‑day schedule.
   *
   * Supports:
   * - New format:
   *   "MON:09:00/17:00|TUE:10:00/18:00|...|SUN:closed"
   * - Legacy:
   *   "09:00/17:00" or "08:00:00/23:00:00" (same time every day)
   *   "closed" (closed all days)
   *
   * @param {string} scheduleStr
   * @returns {Record<string, {start: string; end: string} | null>}
   */
  const parseDeliverySchedule = (scheduleStr) => {
    if (!scheduleStr) return {};

    // New per‑day format with day prefixes
    if (/(MON|TUE|WED|THU|FRI|SAT|SUN):/i.test(scheduleStr)) {
      /** @type {Record<string, {start: string; end: string} | null>} */
      const schedule = {};
      const dayEntries = scheduleStr.split("|");

      for (const entry of dayEntries) {
        const colonIndex = entry.indexOf(":");
        if (colonIndex === -1) continue;

        const day = entry.substring(0, colonIndex).toUpperCase();
        const timeRange = entry.substring(colonIndex + 1).trim();
        if (!timeRange) continue;

        if (timeRange.toLowerCase() === "closed") {
          schedule[day] = null;
        } else if (timeRange.includes("/")) {
          const [start, end] = timeRange.split("/");
          schedule[day] = {
            start: start.trim(),
            end: end.trim(),
          };
        }
      }

      return schedule;
    }

    // Legacy "closed": closed all days
    const trimmed = scheduleStr.trim().toLowerCase();
    if (trimmed === "closed") {
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

    // Legacy time‑range: "HH:MM/HH:MM" or "HH:MM:SS/HH:MM:SS"
    if (scheduleStr.includes("/")) {
      const [start, end] = scheduleStr.split("/");
      const range = { start: start.trim(), end: end.trim() };
      return {
        MON: range,
        TUE: range,
        WED: range,
        THU: range,
        FRI: range,
        SAT: range,
        SUN: range,
      };
    }

    return {};
  };

  /**
   * Check if orderTime is inside today's allowed window.
   * Day chosen using UTC weekday (to match UTC timestamps).
   *
   * @param {Record<string, {start: string; end: string} | null>} schedule
   * @param {Date} currentTime
   * @returns {boolean}
   */
  const checkDaySpecificAvailability = (schedule, currentTime) => {
    const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const currentDay = dayNames[currentTime.getUTCDay()];
    const daySchedule = schedule[currentDay];

    if (!daySchedule) return false;

    try {
      const startTs = convertToTimestamp(daySchedule.start, currentTime);
      const endTs = convertToTimestamp(daySchedule.end, currentTime);
      const nowTs = currentTime.getTime(); // epoch ms (UTC)

      return startTs < nowTs && nowTs < endTs;
    } catch {
      return false;
    }
  };

  /**
   * Check if orderTimestamp falls inside any unavailable date/time range.
   *
   * @param {string[]} unavailableDays
   * @param {number} orderTs
   * @returns {boolean}
   */
  const checkDeliveryUnavailableDays = (unavailableDays, orderTs) => {
    return unavailableDays.some((entry) => {
      const [from, to] = entry.split("/");
      const fromTs = convertToTimestamp(from, orderTime);
      const toTs = convertToTimestamp(to, orderTime);
      return fromTs < orderTs && orderTs < toTs;
    });
  };

  // --- Business logic ------------------------------------------------------

  // 1. If no products have the 2hr delivery tag, hide the 2hr option.
  if (!has2hrDeliveryTag) {
    return hide2hrDeliveryOption();
  }

  // 2. Find which metafield group the zip code belongs to (if any).
  let zipGroupIndex = -1;
  for (let i = 0; i < allowedZipcodesGroups.length; i++) {
    if (allowedZipcodesGroups[i].includes(deliveryZip)) {
      zipGroupIndex = i;
      break;
    }
  }

  // 3. If zip code doesn't match any group, hide 2hr delivery.
  if (zipGroupIndex === -1) {
    return hide2hrDeliveryOption();
  }

  // 4. Read schedule/unavailable ranges for the matching group.
  const deliveryAvailableTimeStr =
    deliveryAvailableTimeGroups[zipGroupIndex] || "";
  const deliveryUnavailableDays =
    deliveryUnavailableDaysGroups[zipGroupIndex] || [];

  const deliverySchedule = parseDeliverySchedule(deliveryAvailableTimeStr);

  const deliveryAvailable = checkDaySpecificAvailability(
    deliverySchedule,
    orderTime
  );

  const deliveryUnavailableDay =
    deliveryUnavailableDays.length > 0 &&
    checkDeliveryUnavailableDays(deliveryUnavailableDays, orderTimestamp);

  // 5. If any constraint fails, hide the 2hr delivery option.
  if (!deliveryAvailable || deliveryUnavailableDay) {
    return hide2hrDeliveryOption();
  }

  // 6. Otherwise, leave options unchanged.
  return NO_CHANGES;
}