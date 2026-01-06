# app/services/split_logic.py
from typing import List, Dict
from ..models import Expense

def calculate_balances(expenses: List[Expense]) -> Dict[str, float]:
    """
    Returns a dictionary of { "PersonName": NetBalance }
    Positive Balance = They are owed money.
    Negative Balance = They owe money.
    """
    balances = {}

    def update_balance(person, amount):
        balances[person] = balances.get(person, 0.0) + amount

    for exp in expenses:
        payer = exp.paidby.strip()
        cost = exp.pound if exp.pound else (exp.rupee / exp.rate if exp.rate else 0)
        
        # 1. The Payer gets positive credit for the full amount
        update_balance(payer, cost)

        # 2. The cost is distributed among the splitters
        # Assuming 'splitwith' is a CSV string like "Me,Alice,Bob"
        if exp.splitwith:
            splitters = [s.strip() for s in exp.splitwith.split(',')]
            # If pplsplit is set, use it, otherwise count the names
            count = exp.pplsplit if exp.pplsplit > 0 else len(splitters)
            
            split_amount = cost / count
            
            for person in splitters:
                # Each person involved gets a negative debit
                update_balance(person, -split_amount)

    return balances