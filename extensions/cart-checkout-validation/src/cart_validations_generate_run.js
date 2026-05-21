// @ts-check

/**
 * @typedef {import("../generated/api").CartValidationsGenerateRunInput} CartValidationsGenerateRunInput
 * @typedef {import("../generated/api").CartValidationsGenerateRunResult} CartValidationsGenerateRunResult
 */

/**
 * Backend validation for pickup store selection:
 * - Agar selected delivery option "Store Pick Up ..." hai
 * - Aur cart attribute "Pickup-Store" empty hai
 * - To checkout block karo aur message dikhao:
 *   "Please select your pick up store"
 *
 * @param {CartValidationsGenerateRunInput} input
 * @returns {CartValidationsGenerateRunResult}
 */
export function cartValidationsGenerateRun(input) {
  /** @type {CartValidationsGenerateRunResult["operations"][number]["validationAdd"]["errors"]} */
  const errors = [];

  const deliveryGroups = input.cart?.deliveryGroups ?? [];
  const firstGroup = deliveryGroups[0];

  const selectedDeliveryOptionTitle =
    firstGroup?.selectedDeliveryOption?.title ?? '';

  const isStorePickUpSelected = selectedDeliveryOptionTitle
    .toLowerCase()
    .replace(/\s+/g, '')
    .includes('storepickup');

  if (isStorePickUpSelected) {
    // GraphQL me hum pickupStore: attribute(key: "Pickup-Store") alias use kar rahe hain
    const pickUpStoreValue = input.cart?.pickupStore?.value ?? '';

    if (!pickUpStoreValue.trim()) {
      errors.push({
        // ✅ Correct field name in 2026 schema
        message: 'Please select your pick up store',
        // ✅ Supported target: whole cart (see docs "Supported checkout field targets")
        target: '$.cart',
      });
    }
  }

  // 2026 schema: return operations[] with validationAdd
  if (errors.length === 0) {
    return {operations: []};
  }

  return {
    operations: [
      {
        validationAdd: {
          errors,
        },
      },
    ],
  };
}