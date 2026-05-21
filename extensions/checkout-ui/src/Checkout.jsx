  import '@shopify/ui-extensions/preact';
  import {render} from 'preact';
  import {useState, useEffect} from 'preact/hooks';
  import {
    useShippingOptionTarget,
    useBuyerJourneyIntercept,
    useApplyAttributeChange,
    useCartLines,
    useApi,
    useShippingAddress,
  } from '@shopify/ui-extensions/checkout/preact';

  // PickUpStore options
  const pickupStoreOptions = [
    {value: '', label: 'Select Your Pick Up Store', disabled: true},
    {value: 'Airport West', label: 'Airport West'},
    {value: 'Aspley', label: 'Aspley'},
    {value: 'Campbellfield', label: 'Campbellfield'},
    {value: 'Geelong', label: 'Geelong'},
    {value: 'Hallam', label: 'Hallam'},
    {value: 'Hoppers Crossing', label: 'Hoppers Crossing'},
    {value: 'Seaford', label: 'Seaford'},
    {value: 'Kilsyth', label: 'Kilsyth'},
    {value: 'Modbury', label: 'Modbury'},
    {value: 'Moorabbin', label: 'Moorabbin'},
    {value: 'Morphett Vale', label: 'Morphett Vale'},
    {value: 'Palmerston', label: 'Palmerston'},
    {value: 'Springvale', label: 'Springvale'},
    {value: 'St Marys', label: 'St Marys'},
    {value: 'Stuart Park', label: 'Stuart Park'},
    {value: 'Sunshine', label: 'Sunshine'},
    {value: 'Thomastown', label: 'Thomastown'},
  ];

  // Aapka original pattern ke close rehne ke liye:
  export default function extension(root) {
    const target = root || document.body;
    console.log('[EXT] Mounting extension on target:', target);
    render(<Extension />, target);
  }
    
  function Extension() {
    console.log('--- [EXT] Render start ---');
    const [pickUpStoreValue, setPickUpStoreValue] = useState('');
    /** @type {[string[], (v: string[]) => void]} */
    const [disabledLocations, setDisabledLocations] = useState([]);
    const [hasClearanceItem, setHasClearanceItem] = useState(false);
    /** @type {[string[], (v: string[]) => void]} */
    const [clearanceTitles, setClearanceTitles] = useState([]);

    // 2hr delivery UI ke liye product titles
    /** @type {[string[], (v: string[]) => void]} */
    const [with2hrTitles, setWith2hrTitles] = useState([]);
    /** @type {[string[], (v: string[]) => void]} */
    const [without2hrTitles, setWithout2hrTitles] = useState([]);

    const applyAttributeChange = useApplyAttributeChange();
    const {shippingOptionTarget, isTargetSelected} = useShippingOptionTarget();
    const shippingAddress = useShippingAddress();
    const shippingAddressPhone = shippingAddress?.phone;

    const shippingOptionTitle = shippingOptionTarget?.title ?? '';

    const normalizedShippingTitle = shippingOptionTitle
      .toLowerCase()
      .replace(/\s+/g, '');

    const isStorePickUpSelected =
      isTargetSelected &&
      normalizedShippingTitle.includes('storepickup');

    const is2hrDeliverySelected =
      isTargetSelected &&
      normalizedShippingTitle.includes('2hrdelivery');

    const cartLines = useCartLines();
    const {query} = useApi();

    const showClearanceErrorBlock =
      pickUpStoreValue &&
      hasClearanceItem &&
      disabledLocations.includes(pickUpStoreValue);

    console.log('[EXT] shippingOptionTitle:', shippingOptionTitle);
    console.log('[EXT] normalizedShippingTitle:', normalizedShippingTitle);
    console.log('[EXT] isTargetSelected:', isTargetSelected);
    console.log('[EXT] isStorePickUpSelected:', isStorePickUpSelected);
    console.log('[EXT] is2hrDeliverySelected:', is2hrDeliverySelected);

    // ---------------- disabled_locations metafield --------------------
    useEffect(() => {
      async function fetchSettings() {
        console.log('[EXT] fetchSettings() START');

        const res = await query(
          `
          query DisabledLocations {
            shop {
              metafield(namespace: "custom", key: "disabled_locations") {
                value
              }
            }
          }
        `,
        );

        console.log('[EXT] DisabledLocations raw response:', res);

        try {
          const raw = res.data?.shop?.metafield?.value ?? '[]';
          console.log('[EXT] DisabledLocations metafield value:', raw);

          const parsed = JSON.parse(raw);
          console.log('[EXT] DisabledLocations parsed:', parsed);

          setDisabledLocations(Array.isArray(parsed) ? parsed : []);
        } catch (err) {
          console.log('[EXT] Error parsing disabled_locations JSON:', err);
          setDisabledLocations([]);
        }
      }

      fetchSettings();
    }, [query]);

    // ---------------- Clearance products + 2hr titles -----------------
    useEffect(() => {
      async function fetchProducts() {
        console.log('[EXT] fetchProducts() START, cartLines:', cartLines);

        if (!cartLines.length) {
          console.log('[EXT] No cart lines, clearing product state');
          setHasClearanceItem(false);
          setClearanceTitles([]);
          setWith2hrTitles([]);
          setWithout2hrTitles([]);
          return;
        }

        const ids = cartLines
          .map((line) => line.merchandise?.product?.id)
          .filter(Boolean);

        console.log('[EXT] Product IDs for query:', ids);

        if (!ids.length) {
          console.log('[EXT] No product IDs after filter, skipping');
          return;
        }

        const res = await query(
          `
          query GetProductsFor2hrAndClearance($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Product {
                id
                title
                tags
              }
            }
          }
        `,
          {variables: {ids}},
        );

        console.log('[EXT] GetProductsFor2hrAndClearance response:', res);

        const nodes = res.data?.nodes ?? [];
        console.log('[EXT] nodes:', nodes);

        const clearanceProducts = [];
        const with2hr = [];
        const without2hr = [];

        for (const product of nodes) {
          if (!product) continue;

          const tags = product.tags || [];
          console.log('[EXT] Product:', product.title, 'tags:', tags);

          // Clearance tag "noispickup"
          const hasClearance = tags.some(
            (tag) => tag.toLowerCase().replace(/\s+/g, '') === 'noispickup',
          );
          if (hasClearance) {
            clearanceProducts.push(product);
          }

          // 2hr delivery ke tags: "quickie" ya "2hrdelivery"
          const has2hrTag = tags.some((tag) => {
            const normalizedTag = tag.toLowerCase().replace(/\s+/g, '');
            return (
              normalizedTag === 'quickie' || normalizedTag === '2hrdelivery'
            );
          });

          if (has2hrTag) {
            with2hr.push(product.title);
          } else {
            without2hr.push(product.title);
          }
        }

        console.log('[EXT] clearanceProducts:', clearanceProducts);
        console.log('[EXT] with2hr titles:', with2hr);
        console.log('[EXT] without2hr titles:', without2hr);

        setHasClearanceItem(clearanceProducts.length > 0);
        setClearanceTitles(
          clearanceProducts.map((product) => product.title).filter(Boolean),
        );
        setWith2hrTitles(with2hr.filter(Boolean));
        setWithout2hrTitles(without2hr.filter(Boolean));
      }

      fetchProducts();
    }, [cartLines, query]);

    // ---------------- Pickup store attribute --------------------------
    useEffect(() => {
      if (pickUpStoreValue) {
        console.log(
          '[EXT] Updating attribute Pickup-Store to:',
          pickUpStoreValue,
        );
        applyAttributeChange({
          type: 'updateAttribute',
          key: 'Pickup-Store',
          value: pickUpStoreValue,
        });
      }
    }, [pickUpStoreValue, applyAttributeChange]);

    // ---------------- Order timestamp attribute -----------------------
    useEffect(() => {
      const timestamp = Date.now().toString();
      console.log('[EXT] Setting Order-Timestamp attribute:', timestamp);

      applyAttributeChange({
        type: 'updateAttribute',
        key: 'Order-Timestamp',
        value: timestamp,
      });
    }, [applyAttributeChange]);

    const handlePickUpStoreChange = (value) => {
      const selected = value?.target?.value ?? value;
      console.log('[EXT] handlePickUpStoreChange, selected:', selected);
      setPickUpStoreValue(selected);
    };

    // ---------------- Checkout blocking logic -------------------------
    useBuyerJourneyIntercept(({canBlockProgress}) => {
      console.log(
        '[EXT] useBuyerJourneyIntercept, canBlockProgress:',
        canBlockProgress,
      );

      if (!canBlockProgress) return {behavior: 'allow'};

      if (!shippingAddressPhone && is2hrDeliverySelected) {
        console.log('[EXT] Blocking: PHONE_REQUIRED_FOR_2HR');
        return {
          behavior: 'block',
          reason: 'PHONE_REQUIRED_FOR_2HR',
          errors: [{message: 'Phone number is required'}],
        };
      }

      if (!pickUpStoreValue && isStorePickUpSelected) {
        console.log('[EXT] Blocking: PICKUP_STORE_REQUIRED');
        return {
          behavior: 'block',
          reason: 'PICKUP_STORE_REQUIRED',
          errors: [{message: 'Please select your pick up store'}],
        };
      }

      if (
        hasClearanceItem &&
        pickUpStoreValue &&
        disabledLocations.includes(pickUpStoreValue)
      ) {
        console.log('[EXT] Blocking: CLEARANCE_ITEMS_NOT_ALLOWED_AT_STORE');
        return {
          behavior: 'block',
          reason: 'CLEARANCE_ITEMS_NOT_ALLOWED_AT_STORE',
          errors: [
            {
              message: 'Unavailable for Clearance items',
            },
          ],
        };
      }

      console.log('[EXT] Allowing buyer journey');
      return {behavior: 'allow'};
    });

    // ---------------- UI: Store Pickup -------------------
    if (isStorePickUpSelected) {
      console.log('[EXT] Rendering Store Pickup UI');
      return (
        <s-stack direction="block" gap="small-200">
          <s-select
            label="Select store"
            value={pickUpStoreValue}
            required
            onChange={handlePickUpStoreChange}
          >
            {pickupStoreOptions.map((option) => (
              <s-option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </s-option>
            ))}
          </s-select>

          {showClearanceErrorBlock && (
            <s-stack direction="block">
              <s-text tone="critical">
                Clearance items are unavailable for Store Pick Up at this
                location:
              </s-text>
              {clearanceTitles.map((title) => (
                <s-text key={title} tone="critical">
                  * {title}
                </s-text>
              ))}
              <s-text tone="critical">
                Select another delivery method to proceed
              </s-text>
            </s-stack>
          )}
        </s-stack>
      );
    }

    // ---------------- UI: 2hr Delivery (sirf UI-part) ----------------
      // ---------------- UI: 2hr Delivery (sirf UI-part) ----------------
    if (is2hrDeliverySelected) {
      console.log('[EXT] Rendering 2hr Delivery UI', {
        with2hrTitles,
        without2hrTitles,
      });

      const hasFastItems = with2hrTitles.length > 0;
      const hasSlowItems = without2hrTitles.length > 0;

      if (!hasFastItems && !hasSlowItems) {
        console.log('[EXT] No items to show in 2hr UI, returning null');
        return null;
      }

      return (
        <s-stack direction="block" gap="small-200">
          {hasFastItems && (
            <s-banner tone="success" heading="Arriving within 2 hours">
              <s-stack direction="block" gap="extra-tight">
                {with2hrTitles.map((title) => (
                  <s-text key={title}>{title}</s-text>
                ))}
              </s-stack>
            </s-banner>
          )}

          {hasSlowItems && (
            <s-banner
              tone="info"
              heading="Arriving separately in 3–5 days"
            >
              <s-stack direction="block" gap="extra-tight">
                {without2hrTitles.map((title) => (
                  <s-text key={title}>{title}</s-text>
                ))}
              </s-stack>
            </s-banner>
          )}
        </s-stack>
      );
    }

    // Kisi aur shipping method ke liye kuch bhi mat dikhao
    return null;
  }