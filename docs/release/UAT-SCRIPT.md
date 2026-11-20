# WtrDrop UAT script: owner and delivery staff

**Who:** the owner (portal and customer app), one or two delivery staff (staff app), one person acting as a
customer. **On what:** staging server and the preview builds (APK on Android phones). Use test customers whose
names start with "UAT". About 2 hours. Mark each step Pass, Fail or Note, and write down anything confusing even
when it works.

The same six workflows already pass as automated tests (`apps/api/test/uat.test.ts`); this session checks
that real people find them easy, on real phones, in both languages.

## 0. Before starting (office)

| # | Step | Expected |
| --- | --- | --- |
| 0.1 | Owner signs in to the portal (SMS code, then password) | Today page opens |
| 0.2 | Settings → Business details and Business rules show the real values, not DEMO | Correct values |
| 0.3 | Team: add each delivery person by phone | They appear as Active |

## 1. New customer, first order, delivered with deposit, paid by UPI

| # | Who | Step | Expected |
| --- | --- | --- | --- |
| 1.1 | Customer | Install the app, enter the phone, type the SMS code | Asked for name and to accept the privacy notice |
| 1.2 | Customer | Add the home address (try "Save my current location") | Home shows "Order water" |
| 1.3 | Customer | Order 2 cans for tomorrow morning | Total shows cans, deposit and delivery charge; "Order placed"; asked to allow notifications |
| 1.4 | Owner | Today → Orders to accept → accept it (unless orders are accepted automatically) | Customer sees "Accepted" |
| 1.5 | Owner | Assign it to the delivery person | It appears on their route |
| 1.6 | Staff | Start the day, load cans, open the stop, tap Delivered, choose UPI | Saved; next stop shown |
| 1.7 | Customer | Check Home and Messages | "Delivered" with cans and amount |
| 1.8 | Owner | Payments → UPI to check → mark as received after seeing it in the bank | Dues go to zero |

## 2. Regular reorder, empties back, dues

| # | Who | Step | Expected |
| --- | --- | --- | --- |
| 2.1 | Customer | Reorder 2 cans in one tap from Home | No deposit this time |
| 2.2 | Staff | Deliver, take 2 empties back, choose "Pay later" | Saved |
| 2.3 | Owner | Payments → Dues | The customer shows the amount due; "Remind" sends a message once a day |
| 2.4 | Customer | Account → Statement | The delivery and the amount due |

## 3. Failed delivery, rescheduled, delivered

| # | Who | Step | Expected |
| --- | --- | --- | --- |
| 3.1 | Staff | Open a stop, tap Not delivered, choose "Door locked" | Marked not delivered with the reason |
| 3.2 | Customer | Check Messages | "Not delivered: door locked" |
| 3.3 | Owner | Today → Failed deliveries → re-book for the next day | New date shown to the customer |
| 3.4 | Staff | Next day: deliver it | Delivered |

## 4. A delivery person's whole day, with the phone offline

| # | Who | Step | Expected |
| --- | --- | --- | --- |
| 4.1 | Staff | Start the day with 10+ stops | Route in order with addresses and landmarks |
| 4.2 | Staff | Switch on Airplane mode, deliver 2 stops | Saved on the phone, shown as not sent yet |
| 4.3 | Staff | Switch Airplane mode off | They send by themselves; nothing doubled |
| 4.4 | Staff | End the day: count cash and full cans returned | Shows the difference, if any |
| 4.5 | Owner | Today → Routes to check → check the route | Cash difference visible; route marked checked |

## 5. Office phone orders, bulk assign, driver absent

| # | Who | Step | Expected |
| --- | --- | --- | --- |
| 5.1 | Owner | Orders → New order for a customer who phoned | Order saved in under a minute |
| 5.2 | Owner | Select several orders → assign to one driver | All on that route |
| 5.3 | Owner | Move the route to the other driver (the first is "absent") | Second driver sees it; first does not |

## 6. Correction, complaint, activity log

| # | Who | Step | Expected |
| --- | --- | --- | --- |
| 6.1 | Owner | Customer page → correct cans held (with a reason) | New balance; reason required |
| 6.2 | Customer | Help → Report a problem → "Can count wrong" | Sent |
| 6.3 | Owner | Complaints → resolve with a note | Customer sees the note under the complaint and as a message |
| 6.4 | Owner | Reports → Activity log | The correction and the complaint, with who and when |
| 6.5 | Owner | Reports → Sales, Dues, Staff → Download CSV, open in Excel | ₹ and Malayalam names show correctly |

## 7. Language, account and help

| # | Who | Step | Expected |
| --- | --- | --- | --- |
| 7.1 | Customer, staff | Switch to മലയാളം | Every screen readable and natural; note any odd wording |
| 7.2 | Customer | Help → Call us, WhatsApp us | Opens the phone and WhatsApp with the business number |
| 7.3 | Customer with nothing due | Account → Delete my account → Delete | Signed out; the portal shows "Account deleted" |
| 7.4 | Customer with cans or dues | Account → Delete my account | Told what to settle first; cannot delete |

## Sign-off

| | Name | Date | Result |
| --- | --- | --- | --- |
| Owner | | | |
| Delivery staff 1 | | | |
| Delivery staff 2 | | | |

Open items from the session go to the requirements change log with a decision: fix before launch, or later.
