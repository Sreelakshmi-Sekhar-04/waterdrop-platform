# Store listing (DRAFT for the owner to approve)

**DRAFT.** The business name, support phone, email and website below are placeholders in angle brackets. The
app's store name is "WtrDrop" until the owner chooses otherwise. Nothing is submitted without the owner's
approval. Malayalam text needs a native reader's review.

## Basics

| Field | Value |
| --- | --- |
| App name | WtrDrop |
| Package / bundle id | `app.wtrdrop.mobile` |
| Category | Food & Drink (Play), Food & Drink (App Store) |
| Price | Free, no in-app purchases, no ads |
| Content rating | Everyone / 4+ |
| Countries | India |
| Languages | English, Malayalam |
| Support | `<support phone>`, `<support email>` |
| Privacy policy URL | `<https://…/privacy>` (publish `PRIVACY-POLICY-DRAFT.md` after legal review) |
| Account deletion URL (Play) | in the app: Account → Delete my account; also `<https://…/delete-account>` page explaining it |

## Short description (Play, max 80 characters)

- **English:** Order 20 litre water cans in a tap and see when they arrive.
- **Malayalam:** ഒറ്റ ടാപ്പിൽ 20 ലിറ്റർ വെള്ളം ക്യാൻ ഓർഡർ ചെയ്യൂ, എപ്പോൾ എത്തുമെന്ന് അറിയൂ.

## Full description

**English**

Order drinking water cans from `<business name>` without a phone call.

- Order 20 litre cans for today or a later day, at a delivery time that suits you
- Reorder your usual in one tap
- See the price, deposit and delivery charge before you order
- Know when your order is on the way and when it is delivered
- See cans you hold, deposit paid and anything due in your statement
- Pay cash, UPI or later, as agreed with `<business name>`
- Report a problem or call us from the app
- In English and Malayalam

For `<business name>`'s delivery staff, the same app shows the day's route, records each delivery even without
mobile signal, and closes the day's cash.

**Malayalam**

ഫോൺ വിളിക്കാതെ `<business name>`-ൽ നിന്ന് കുടിവെള്ള ക്യാനുകൾ ഓർഡർ ചെയ്യൂ.

- ഇന്നത്തേക്കോ പിന്നീടൊരു ദിവസത്തേക്കോ, സൗകര്യമുള്ള സമയത്ത് 20 ലിറ്റർ ക്യാനുകൾ ഓർഡർ ചെയ്യൂ
- പതിവ് ഓർഡർ ഒറ്റ ടാപ്പിൽ വീണ്ടും
- ഓർഡർ ചെയ്യുന്നതിന് മുമ്പ് വില, ഡെപ്പോസിറ്റ്, ഡെലിവറി ചാർജ് കാണാം
- ഓർഡർ വഴിയിലാണോ, എത്തിയോ എന്ന് അറിയാം
- കയ്യിലുള്ള ക്യാനുകൾ, അടച്ച ഡെപ്പോസിറ്റ്, ബാക്കി തുക എന്നിവ സ്റ്റേറ്റ്മെന്റിൽ
- `<business name>`-മായി സമ്മതിച്ചതുപോലെ പണം, UPI അല്ലെങ്കിൽ പിന്നീട്
- ആപ്പിൽ നിന്ന് പരാതി അറിയിക്കാം, വിളിക്കാം
- ഇംഗ്ലീഷിലും മലയാളത്തിലും

`<business name>`-ന്റെ ഡെലിവറി ജീവനക്കാർക്ക് ഇതേ ആപ്പിൽ ദിവസത്തെ റൂട്ട് കാണാം, മൊബൈൽ സിഗ്നൽ ഇല്ലെങ്കിലും ഡെലിവറി രേഖപ്പെടുത്താം,
ദിവസാവസാനം പണം ഒത്തുനോക്കാം.

## Screenshots (phone, both languages)

Taken from the preview build on a real phone after UAT, with UAT test customers only (no real names or numbers):
Home, Order, Order placed, Orders, Statement, Help; staff Route and Delivery. Phase 7 browser screenshots in
`/mnt/project-files/wtrdrop/phase-7/` show the layouts but are not store-ready (web rendering).

## Review notes (for Apple and Google reviewers)

The app is for customers of one water supplier in Kerala, India. Sign-in is by SMS code to an Indian mobile
number. A reviewer account: phone `<test number>`, code `<fixed review code arranged with MSG91 or a review
build>`. Location is used only when the customer taps "Save my current location" for their address.

## Data safety / privacy labels

| Data | Collected | Why | Shared |
| --- | --- | --- | --- |
| Phone number | Yes, required | Sign-in, delivery contact | No |
| Name | Yes, required | Orders and delivery | No |
| Address | Yes, required | Delivery | No |
| Location (precise) | Optional, only when tapped | Pin the delivery address | No |
| Purchase history (orders, payments) | Yes | Orders, statement, accounts | No |
| Device push token | Optional | Order messages | Sent to Expo / Apple / Google only to deliver messages |

Data is encrypted in transit. Users can delete their account in the app.
