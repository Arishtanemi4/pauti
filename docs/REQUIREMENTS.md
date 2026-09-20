# App Requirements

1. Must allow Tracking expenses for individual on a per item level basis and also a holistic per bill spend as per statement basis.
    - The user sometimes might not have the exact item level bill for every spend in a statement, the app must account for these inconsistencies.

2. Must allow to split, share and settle expenses with contacts.
    - The app must allow split on an item level basis of a bill.
    - While also allowing a SplitWise like equal or unequal spilt.
    - There must also be an option to partially split an item between people.

3. **LOCAL ONLY!**. No data ever touches an API.
    - Every split and calculation stays on the device nothing on the net.
    - The splittinh logic is hadled using CRDT design.

4. Groups.
    - App must allow creation of groups similar to SplitWise.

5. One-to-One Expenses.
    - Have a WhatsApp like Chat screen that has list of contacts which shows the amount owed or lent to each contact.
    - If an expense pertains to a group, it must also reflect here.
    - If an expense is settled here that pertains to a group, it must also reflect back to the group as settled.

6. Statement OCR.
    - If a person uploads a Bank statement, the entire expense must be extracted and inputed in the database.

7. Reciept OCR.
    - Similarly, If a person uplaods a bill, the items and all its information must be extracted and inputted in the database.
    - If any expense gets matched with an expense in bank statement, it must get linked in the database.

8. Screens.
    a. Home Screen
        - Dashboard containing Daily, Weekly Monthly and Yearly Expenses. (Just one component which can be switched between each others to save space.)
        - Amount owed and lent and net debt or lending.
    b. Chat Screen.
    c. Groups Screen.
    d. Add Expense Screen.