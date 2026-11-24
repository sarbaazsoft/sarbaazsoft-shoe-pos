import { APP_VERSION } from '../version.ts';

export type LicenseAgreementType = 'free_trial' | 'premium';

export interface LicenseClause {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LicenseSection {
  number: string;
  title: string;
  highlighted?: boolean;
  paragraphs?: string[];
  bullets?: string[];
  subsections?: LicenseClause[];
}

export interface LicenseAgreementDocument {
  id: LicenseAgreementType;
  title: string;
  shortTitle: string;
  badgeText: string;
  productName: string;
  licensor: string;
  planScope: string;
  promotionalNotice: string;
  sections: LicenseSection[];
  acceptanceChecklist: string[];
  footerNote: string;
}

export const LICENSE_AGREEMENTS: Record<LicenseAgreementType, LicenseAgreementDocument> = {
  free_trial: {
    id: 'free_trial',
    title: 'Free Trial Software License Agreement',
    shortTitle: 'Free Trial License',
    badgeText: '30-Day Evaluation License',
    productName: `SarbaazSoft Shoe POS (${APP_VERSION} and subsequent updates)`,
    licensor: 'SarbaazSoft',
    planScope: '30-Day Free Trial (free_tier / TRIAL)',
    promotionalNotice:
      'All currently displayed paid subscription prices (Rs. 10,000 for 6 Months and Rs. 18,000 for Annual / 1 Year) are introductory promotional prices. SarbaazSoft reserves the right to change, increase, or revise subscription pricing at any time without prior notice. Revised prices apply to any future upgrade or renewal.',
    sections: [
      {
        number: '1',
        title: 'Agreement Overview and Acceptance',
        paragraphs: [
          'This Free Trial Software License Agreement ("Agreement") is a binding legal agreement between SarbaazSoft ("Licensor," "we," "us," or "our") and the business entity, store owner, or authorized individual ("Licensee," "Store Owner," or "you") registering for or using the 30-Day Free Trial of SarbaazSoft Shoe POS (the "Software").',
          'By submitting a Free Trial store registration request, verifying your email address, completing the Store Onboarding Wizard, or accessing and using the Software under the Free Trial plan, you acknowledge that you have read, understood, and agree to be bound by all terms and conditions of this Agreement.',
        ],
      },
      {
        number: '2',
        title: 'Grant of Free Trial License',
        paragraphs: [
          'Subject to your compliance with this Agreement, SarbaazSoft grants you a non-exclusive, non-transferable, non-sublicensable, revocable, limited-term license to access and use the Software solely for internal business evaluation in connection with one (1) single-tenant footwear retail or wholesale store workspace during the Free Trial period.',
        ],
        subsections: [
          {
            heading: '2.1 Term and Duration',
            bullets: [
              'The Free Trial period runs for thirty (30) calendar days from the date and time of initial store provisioning/activation, unless earlier terminated, suspended, or converted to a paid Premium Subscription.',
              'No credit card or advance payment is required to register for or activate the 30-Day Free Trial.',
              'The Free Trial is not automatically converted into a paid subscription and does not trigger automatic billing upon expiration.',
            ],
          },
          {
            heading: '2.2 Activation, Email Verification, and Mandatory Onboarding',
            bullets: [
              'Where email verification is enabled by platform policy, your Store Owner (ADMIN) account remains in a PENDING verification state until you confirm your registered email address using the 6-digit confirmation code or activation link sent to your email. Dashboard and Point-of-Sale (POS) access is withheld until verification is completed.',
              'Upon first authenticated login, the Store Owner must complete the mandatory Store Onboarding Wizard (configuring store identity, optional Cashier credentials, currency, tax, retail/wholesale mode, carton rules, and invoice defaults) before accessing operational POS, Dashboard, or Settings modules.',
            ],
          },
        ],
      },
      {
        number: '3',
        title: 'Scope of Evaluation Features',
        paragraphs: [
          'During an active, verified Free Trial period, SarbaazSoft provides access to the Software’s operational store features for evaluation, including:',
        ],
        bullets: [
          'Dual-Engine Retail & Wholesale POS: High-speed barcode checkout, article and brand search, cash, card, bank transfer, and customer khata split payments, configurable Fixed or Negotiable retail pricing modes (Fixed pricing enforced in wholesale mode), half-carton selling rules, and offline billing queued locally in browser IndexedDB with automatic synchronization upon reconnection.',
          'Footwear Catalog & Stock Ledger: Pair and wholesale carton tracking (such as 12-pair and 16-pair packs and minimum stock thresholds), CSV product import, floor-price margin protection, and Stock Ledger movement auditing.',
          'Purchases & Supplier Khata: Stock receiving, supplier purchase invoices, partial payments, outstanding payables tracking, and supplier returns.',
          'Customer Khata, Returns & Exchanges: Customer account profiles, credit limits, running khata balances, standalone sales returns, and in-POS size or article exchanges.',
          'Direct Thermal & Label Printing: ESC/POS thermal receipt printing (50mm, 58mm, and 80mm templates) and TSPL barcode label printing (Code-128 stickers, A4 24-up sheets, and 3"x4" box/rack labels) via WebUSB or compatible local print agent.',
          'Sales, Profit & Inventory Reports: Daily sales metrics, custom-range Profit & Loss summaries, top-selling articles, inventory valuation, and low-stock notifications.',
          'Multi-Role Access, Alerts, AI & PWA: Store Owner (ADMIN) and Cashier (CASHIER) accounts, custom store branding and 11 color palettes, Web Push notifications and email alerts (where configured), built-in Sammi AI Assistant and smart catalog suggestions (where enabled), and standalone PWA installation across Android, iOS/iPadOS, and Windows.',
        ],
      },
      {
        number: '4',
        title: 'Trial Restrictions and Anti-Abuse Safeguards',
        bullets: [
          'One Trial per Business / Email Identity: Each email address may only be registered once. You may not create repeated or automated Free Trial stores using alternate email addresses or identities to circumvent the 30-day evaluation limit.',
          'Trial Activity & Lifecycle Logging: SarbaazSoft records Free Trial activation and lifecycle metadata—including store name, owner name, email address, phone/WhatsApp number, trial start and end dates, status transitions (PENDING, ACTIVE, EXPIRED, SUSPENDED, CONVERTED, REACTIVATED, EXTENDED), IP address, and browser user agent—for security, support, and trial integrity enforcement.',
          'Prohibited Uses: You may not resell, rent, lease, sublicense, share across unrelated businesses, reverse engineer, decompile, scrape, or bypass tenant isolation, authentication, or subscription-status safeguards within the Software.',
          'Platform Administration Rights: System-wide application configuration and full database SQL/JSON backup and restore utilities remain strictly reserved for authorized Platform SuperAdministrators.',
        ],
      },
      {
        number: '5',
        title: 'Mandatory Pricing and Introductory Promotional Rates Clause',
        highlighted: true,
        paragraphs: [
          'All currently displayed paid subscription prices for SarbaazSoft Shoe POS—including Rs. 10,000 for the 6-Month Plan (6_MONTHS) and Rs. 18,000 for the Annual / 1-Year Plan (YEARLY)—are introductory promotional prices.',
          'SarbaazSoft reserves the right to change, increase, or revise subscription pricing at any time without prior notice.',
        ],
        bullets: [
          'Participation in the 30-Day Free Trial does not lock in or guarantee introductory promotional rates for future paid subscriptions.',
          'If you choose to upgrade from the Free Trial to a Premium Subscription (6_MONTHS or YEARLY), the fee applicable to your upgrade will be the current price in effect at the time your upgrade request is submitted and verified/approved by SarbaazSoft.',
          'Any subsequent renewals, extensions, or reactivations after your initial paid term will likewise be governed by the subscription pricing in effect at the time of each future renewal or purchase.',
        ],
      },
      {
        number: '6',
        title: 'Expiration, Suspension, and Trial Data Handling',
        subsections: [
          {
            heading: '6.1 Automatic Expiration',
            bullets: [
              'Upon reaching the end of the 30-day Free Trial period (or earlier if marked expired by Platform Administration), your store subscription status transitions to EXPIRED.',
              'When EXPIRED, operational POS, inventory, and store API endpoints are restricted (HTTP 403) and CASHIER logins are blocked. The Store Owner (ADMIN) retains restricted access solely to submit a 6-Month or 1-Year Premium Subscription upgrade request with payment reference details via Store Settings to restore access.',
            ],
          },
          {
            heading: '6.2 Suspension and Deletion',
            bullets: [
              'SarbaazSoft may suspend (HTTP 423) or permanently delete any Free Trial workspace in cases of policy violation, suspected trial abuse, fraudulent activity, or prolonged post-expiration inactivity.',
              'Permanent deletion removes the store workspace, trial activation records, tracking history, and operational data. You are solely responsible for exporting or recording any reports, invoices, or catalog records you wish to retain prior to expiration or deletion.',
            ],
          },
        ],
      },
      {
        number: '7',
        title: 'Ownership, Customer Data, and Confidentiality',
        bullets: [
          'Software Ownership: SarbaazSoft retains all right, title, and interest in and to the Software, including its source code, database schemas, user interface, trademarks, branding, and documentation.',
          'Your Store Data: You retain ownership of the product catalog, sales transactions, customer/supplier khata entries, and store profile data you enter during your Free Trial, subject to SarbaazSoft’s right to host, process, and isolate such data per tenant.',
        ],
      },
      {
        number: '8',
        title: 'Disclaimer of Warranties and Limitation of Liability',
        bullets: [
          'The Free Trial is provided free of charge on an "AS IS" and "AS AVAILABLE" basis without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, uptime guarantee, or non-infringement.',
          'You are responsible for verifying tax calculations, floor prices, thermal/barcode print output, and offline browser IndexedDB synchronization before clearing browser storage or switching devices.',
          'To the maximum extent permitted by applicable law, SarbaazSoft shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of profits, revenue, inventory records, or business interruption.',
        ],
      },
      {
        number: '9',
        title: 'Termination',
        paragraphs: [
          'You may discontinue your Free Trial at any time by ceasing use of the Software. SarbaazSoft may terminate or suspend your Free Trial immediately if you breach any term of this Agreement or attempt to abuse trial eligibility. Upon termination or expiration without upgrading to an approved Premium Subscription, all rights to access the Software under this Agreement cease immediately.',
        ],
      },
    ],
    acceptanceChecklist: [
      'You are authorized to bind yourself or your footwear business to this Agreement;',
      'You understand that the Free Trial is limited to 30 days and restricts store POS and staff access (EXPIRED) upon completion unless upgraded to an approved Premium Subscription; and',
      'You understand and agree that all currently displayed subscription prices are introductory promotional prices subject to change or increase by SarbaazSoft at any time without prior notice, with revised pricing applying at the time of any future upgrade or renewal.',
    ],
    footerNote: 'Support Contact: Configurable Platform Administrator (Default: sarbaazsoft@gmail.com / +92-321-2257340)',
  },

  premium: {
    id: 'premium',
    title: 'Premium Subscription Software License Agreement',
    shortTitle: 'Premium Subscription License',
    badgeText: 'Commercial Paid License',
    productName: `SarbaazSoft Shoe POS (${APP_VERSION} and subsequent updates)`,
    licensor: 'SarbaazSoft',
    planScope: '6-Month Plan (6_MONTHS) & Annual / 1-Year Plan (YEARLY)',
    promotionalNotice:
      'All currently displayed subscription prices (Rs. 10,000 for the 6-Month Plan and Rs. 18,000 for the Annual / 1-Year Plan) are introductory promotional prices. SarbaazSoft reserves the right to change, increase, or revise subscription pricing at any time without prior notice. Active already-paid terms remain honored through expiry; revised prices apply to future subscriptions, upgrades, extensions, reactivations, and subsequent renewals.',
    sections: [
      {
        number: '1',
        title: 'Agreement Overview and Acceptance',
        paragraphs: [
          'This Premium Subscription Software License Agreement ("Agreement") governs the paid commercial subscription and use of SarbaazSoft Shoe POS (the "Software") provided by SarbaazSoft ("Licensor," "we," "us," or "our") to the subscribing business, store owner, or legal entity ("Customer," "Subscriber," "Store Owner," or "you").',
          'By selecting a Premium Subscription plan (6_MONTHS or YEARLY), submitting a subscription upgrade, extension, renewal, or reactivation request (including Payment Ref ID details), accepting a SuperAdmin-provisioned paid store account, or continuing to operate the Software under an active paid subscription term, you agree to be bound by this Agreement.',
        ],
      },
      {
        number: '2',
        title: 'Subscription Tiers, Term Duration, and Activation Workflow',
        subsections: [
          {
            heading: '2.1 Available Premium Plans and Introductory Promotional Pricing',
            bullets: [
              '6-Month Plan (6_MONTHS): Six (6) calendar months per term. Currently displayed introductory promotional price: Rs. 10,000 per 6-month term.',
              'Annual / 1-Year Plan (YEARLY): One (1) calendar year (twelve (12) months) per term. Currently displayed introductory promotional price: Rs. 18,000 per annual term (reflecting Rs. 2,000 promotional savings compared to two 6-month terms at introductory rates).',
            ],
          },
          {
            heading: '2.2 Activation, Payment Reference Submission, and SuperAdmin Verification',
            bullets: [
              'New public self-registrations via the landing page initially provision on the 30-Day Free Trial (free_tier) unless provisioned directly as a paid tenant by Platform Administration.',
              'Manual Transfer Verification: SarbaazSoft Shoe POS does not run automated recurring credit-card auto-debits in the app. To purchase, upgrade to, renew, extend, or reactivate a Premium Subscription, the Store Owner (ADMIN) selects 6_MONTHS or YEARLY from the Dashboard or Store Settings, submits a request with valid bank/online transfer Payment Ref ID notes, and awaits verification and approval by an authorized Platform SuperAdministrator.',
              'Note on Active Yearly Plans: Stores currently holding an active 1-Year license see only the 1-Year extension option in the renewal modal to prevent unintended plan downgrades; active 6-Month stores may renew (+6 months) or upgrade to 1-Year (+12 months).',
            ],
          },
        ],
      },
      {
        number: '3',
        title: 'Mandatory Pricing and Introductory Promotional Rates Clause',
        highlighted: true,
        paragraphs: [
          'All currently displayed subscription prices for SarbaazSoft Shoe POS—including Rs. 10,000 for the 6-Month Plan and Rs. 18,000 for the Annual / 1-Year Plan—are introductory promotional prices.',
          'SarbaazSoft reserves the right to change, increase, or revise subscription pricing at any time without prior notice.',
        ],
        bullets: [
          'Current Active Paid Term Protected: Any subscription period for which full payment has already been verified and approved by SarbaazSoft remains valid through its approved end date at the rate paid for that term, with no mid-term price surcharge.',
          'Future Subscriptions and New Stores: Any newly provisioned store or newly activated Premium Subscription is billed at the subscription price in effect on the date the subscription request is submitted and approved.',
          'Renewals, Extensions, Upgrades, and Reactivations: Any price increase or revision takes effect automatically for all subsequent renewal cycles, plan extensions, tier upgrades (including 6-Month to 1-Year upgrades), and post-expiration reactivations initiated after the price revision.',
        ],
      },
      {
        number: '4',
        title: 'Grant of License and Licensed Capabilities',
        paragraphs: [
          'Subject to timely payment and compliance with this Agreement, SarbaazSoft grants you a non-exclusive, non-transferable, non-sublicensable, revocable commercial license during the active subscription term to operate the Software for your designated retail and/or wholesale footwear store, including:',
        ],
        bullets: [
          'Dual-Engine Retail & Wholesale POS: Continuous barcode scanning, article/brand lookup, cash/card/bank transfer/customer khata split payments, Fixed or Negotiable retail pricing modes (Fixed enforced in wholesale mode), wholesale carton and half-carton rules, and offline billing via browser IndexedDB with automatic online sync.',
          'Footwear Catalog & Stock Ledger: Pair and wholesale carton tracking (12/16-pair packs and minimum quantities), CSV product import, floor-price margin guards, low-stock thresholds, and Stock Ledger tracking.',
          'Purchases & Supplier Khata: Stock receiving (Quick Receive), supplier bills, partial payments, payable balances, and supplier returns.',
          'Customer Khata, Returns & Exchanges: Customer profiles, credit limits, running khata balances, standalone sales returns, and instant in-POS size or article exchanges.',
          'Direct Thermal & Barcode Label Printing: ESC/POS thermal receipts (50/58/80mm) and TSPL barcode labels (Code-128 stickers, A4 24-up sheets, and 3"x4" box rack labels) via WebUSB or local print agent.',
          'Financial & Stock Reporting: Daily revenue dashboards, custom date-range Profit & Loss reports, top-selling articles, inventory valuation, and printable Financial Summaries.',
          'Multi-Role Store Workspace, Notifications & PWA: Store Owner (ADMIN) and Cashier (CASHIER) roles with idle lock prompts, custom store logos and 11 brand color themes, Web Push and owner email alerts (where configured), Sammi AI Assistant and smart catalog suggestions (where enabled), and installable PWA support on Android, iOS/iPadOS, and Windows.',
        ],
      },
      {
        number: '5',
        title: 'Permitted Users, Tenant Isolation, and Acceptable Use',
        bullets: [
          'Single-Store Tenant Scope: Each Premium Subscription covers one (1) isolated store tenant. Separate branches, franchises, or independent outlets require separate store subscriptions unless otherwise agreed in writing by SarbaazSoft.',
          'Owner and Cashier Roles: You may create and manage ADMIN and CASHIER accounts for personnel operating within your licensed store and remain responsible for credential confidentiality and staff activity.',
          'Prohibited Conduct: You shall not share a single store workspace across unrelated legal businesses, copy, reverse engineer, or decompile the Software, attempt to access other tenants’ data, or bypass subscription/security safeguards.',
          'Administrative Separation: Platform-wide application settings and full database SQL/JSON backup, export, and restore utilities are strictly reserved for Platform SuperAdministrators.',
        ],
      },
      {
        number: '6',
        title: 'Store Data, Offline Sync, and Backup Responsibilities',
        bullets: [
          'Data Ownership: You retain full ownership of all store records, inventory catalogs, invoices, receipts, and customer/supplier khata ledgers stored within your tenant workspace.',
          'Offline Caching Notice: Pending offline bills are stored locally in your device browser’s IndexedDB until network connectivity is restored. You are responsible for syncing devices online and avoiding clearing browser storage while offline bills are pending.',
          'Independent Records: You are encouraged to regularly export or archive financial summaries, reports, and catalog CSV records for independent accounting.',
        ],
      },
      {
        number: '7',
        title: 'Subscription Expiration, Suspension, and Termination',
        subsections: [
          {
            heading: '7.1 Automatic Expiration (EXPIRED)',
            bullets: [
              'Subscriptions do not auto-renew without payment verification. If a renewal or extension is not submitted and approved before subscription_end_date, store status automatically transitions to EXPIRED.',
              'While EXPIRED, operational POS, inventory, khata, and reporting API endpoints are restricted (HTTP 403) and CASHIER logins are blocked. The Store Owner (ADMIN) may still sign in solely to submit a 6-Month or 1-Year renewal request with payment reference details from Store Settings to initiate reactivation.',
            ],
          },
          {
            heading: '7.2 Suspension (SUSPENDED) and Termination',
            bullets: [
              'SarbaazSoft may suspend store access immediately (HTTP 423)—pausing all ADMIN and CASHIER sessions—if payment references are invalid, reversed, disputed, or fraudulent, or if you materially breach this Agreement.',
              'Paid subscription fees are non-refundable once a paid term has been verified and activated, except where required by applicable law or expressly approved by SarbaazSoft.',
            ],
          },
        ],
      },
      {
        number: '8',
        title: 'Support, Updates, Warranty Disclaimer, and Limitation of Liability',
        bullets: [
          'Updates & Support: During an active paid subscription, you receive access to bug fixes, security updates, and standard enhancements released for your subscribed tier.',
          'Warranty Disclaimer: Except as required by non-waivable law, the Software is provided "AS IS" and "AS AVAILABLE" without warranties regarding third-party networks, printer hardware, WebUSB drivers, or external notification/AI providers.',
          'Limitation of Liability: To the fullest extent permitted by law, SarbaazSoft shall not be liable for any indirect, incidental, special, consequential, or punitive damages. SarbaazSoft’s total aggregate liability arising out of this Agreement shall not exceed the total subscription fees actually paid by you for the specific store during the active paid subscription term (6_MONTHS or YEARLY) immediately preceding the claim.',
        ],
      },
    ],
    acceptanceChecklist: [
      'You have read and accept all terms of this Premium Subscription Software License Agreement;',
      'Paid access is granted per single-store tenant for the verified 6_MONTHS or YEARLY term and requires verified renewal prior to expiration to prevent EXPIRED service restriction; and',
      'All currently displayed subscription prices (Rs. 10,000 for 6 Months and Rs. 18,000 for 1 Year) are introductory promotional prices that SarbaazSoft may change, increase, or revise at any time without prior notice, with revised rates applying to all future subscriptions, upgrades, extensions, and upcoming renewals.',
    ],
    footerNote: 'Support Contact: Configurable Platform Administrator (Default: sarbaazsoft@gmail.com / +92-321-2257340)',
  },
};
