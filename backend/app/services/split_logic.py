from sqlalchemy.orm import Session
from sqlalchemy import func
from .. import models


def get_net_balances(db: Session, user_id: str):
    """
    Calculates how much 'user_id' is owed vs how much they owe.
    Returns: { "Alice": +500 (Alice owes you), "Bob": -200 (You owe Bob) }
    """
    balances = {}

    # 1. Money people owe YOU (You paid, they are the debtor in splits)
    # We find splits where YOU are the payer of the transaction
    # (This requires joining Split -> TransactionHeader to check payer)
    
    owed_to_you = db.query(
        models.ExpenseSplit.debtor_id,
        func.sum(models.ExpenseSplit.owned_amount)
    ).join(models.TransactionHeader, models.ExpenseSplit.trxn_id == models.TransactionHeader.trxn_id)\
     .filter(models.TransactionHeader.payer_user_id == user_id)\
     .filter(models.ExpenseSplit.is_settled == False)\
     .group_by(models.ExpenseSplit.debtor_id).all()

    for debtor, amount in owed_to_you:
        # If Alice is the debtor, she owes you positive amount
        balances[debtor] = balances.get(debtor, 0) + amount

    # 2. Money YOU owe others (They paid, you are the debtor)
    you_owe = db.query(
        models.TransactionHeader.payer_user_id,
        func.sum(models.ExpenseSplit.owned_amount)
    ).join(models.ExpenseSplit, models.ExpenseSplit.trxn_id == models.TransactionHeader.trxn_id)\
     .filter(models.ExpenseSplit.debtor_id == user_id)\
     .filter(models.ExpenseSplit.is_settled == False)\
     .group_by(models.TransactionHeader.payer_user_id).all()

    for creditor, amount in you_owe:
        # If Bob is the creditor (payer), you owe him (negative balance)
        balances[creditor] = balances.get(creditor, 0) - amount
        
    return balances