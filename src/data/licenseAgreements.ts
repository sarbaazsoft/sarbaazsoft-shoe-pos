import { APP_VERSION } from '../version.ts';

export interface LicenseSection {
  number: string;
  title: string;
  bullets: string[];
}

export interface SoftwareLicenseDocument {
  title: string;
  shortTitle: string;
  badgeText: string;
  productName: string;
  licensor: string;
  planScope: string;
  sections: LicenseSection[];
  acceptanceChecklist: string[];
  footerNote: string;
}

export const SOFTWARE_LICENSE_AGREEMENT: SoftwareLicenseDocument = {
  title: 'Software License Agreement',
  shortTitle: 'Software License',
  badgeText: 'Free Trial & Premium Plans',
  productName: `SarbaazSoft Shoe POS (${APP_VERSION})`,
  licensor: 'SarbaazSoft',
  planScope: '30-Day Free Trial • 6-Month (Rs. 10,000) • Annual (Rs. 18,000)',
  sections: [
    {
      number: '1',
      title: 'Scope & Acceptance',
      bullets: [
        'This Agreement governs both the 30-Day Free Trial (free_tier) and paid Premium Plans (6_MONTHS & YEARLY) for SarbaazSoft Shoe POS.',
        'By registering a store, verifying your email, completing onboarding, or submitting a subscription upgrade/renewal request, you agree to these terms on behalf of your store.',
      ],
    },
    {
      number: '2',
      title: 'Trial & Paid Plan Terms',
      bullets: [
        'Free Trial (30 Days): Free evaluation for one store with no credit card or auto-billing. Requires email confirmation and initial onboarding setup before POS/Dashboard access. Limited to one trial per email/business.',
        'Premium Plans (6 Months / 1 Year): Commercial access per single-store tenant, activated after submitting a valid Payment Ref ID and SuperAdmin verification from Dashboard or Store Settings.',
      ],
    },
    {
      number: '3',
      title: 'Promotional Pricing & Rate Revisions',
      bullets: [
        'Displayed rates (Rs. 10,000 for 6 Months; Rs. 18,000 for 1 Year) are introductory promotional prices and may be changed or increased at any time without prior notice.',
        'Already-paid active terms remain valid through expiry at the paid rate; revised pricing applies automatically to future subscriptions, trial upgrades, extensions, and renewals.',
      ],
    },
    {
      number: '4',
      title: 'Permitted Use & Core Features',
      bullets: [
        'Includes retail/wholesale POS, carton & pair stock ledger, customer/supplier khata, thermal & barcode printing, reports, alerts, and PWA installation for your store ADMIN and CASHIER accounts.',
        'You may not resell, share one store workspace across separate businesses, create duplicate trials, reverse engineer the Software, or bypass security/subscription checks.',
      ],
    },
    {
      number: '5',
      title: 'Store Data, Offline Sync & Expiry',
      bullets: [
        'You retain ownership of your store catalog, sales, and khata records. Offline bills queue locally in browser IndexedDB—always sync online before clearing browser data.',
        'Unrenewed trials or paid terms switch to EXPIRED (restricting POS/Cashier access until renewed) and may be suspended or removed for policy abuse or prolonged inactivity. Paid fees are non-refundable once activated.',
      ],
    },
    {
      number: '6',
      title: 'Warranty & Liability Limit',
      bullets: [
        'Provided "AS IS" without warranty for third-party internet, printers, or external services. SarbaazSoft is not liable for indirect or consequential damages; total liability is capped at fees actually paid for your current store term.',
      ],
    },
  ],
  acceptanceChecklist: [
    'You are authorized to accept this Software License Agreement for your store.',
    'Free Trial lasts 30 days (one per email/business); Premium terms require verified 6-Month or Annual payment approval.',
    'Displayed rates are introductory promotional prices subject to change without prior notice for future upgrades and renewals.',
  ],
  footerNote: 'Support: sarbaazsoft@gmail.com • +92-321-2257340',
};
