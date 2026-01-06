# app/routers/analytics.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from ..database import get_db
from ..models import Expense
from ..services.split_logic import calculate_balances

router = APIRouter(prefix="/analytics", tags=["Analytics"])

@router.get("/balances")
def get_splitwise_balances(db: Session = Depends(get_db)):
    expenses = db.query(Expense).all()
    # While we can do this on the server, sending the raw expenses 
    # allows the phone to calculate this offline too.
    return calculate_balances(expenses)

@router.get("/summary")
def get_expense_summary(db: Session = Depends(get_db)):
    """
    Returns aggregation for graphs (Daily, Weekly, Monthly)
    """
    # Example: Total spend by Product Type
    breakdown = db.query(
        Expense.producttype, func.sum(Expense.pound)
    ).group_by(Expense.producttype).all()
    
    return [{"category": b[0], "total_gbp": b[1]} for b in breakdown]