# app/schemas.py
from pydantic import BaseModel
from datetime import date
from typing import Optional

class ExpenseBase(BaseModel):
    date: date
    pound: Optional[float] = 0.0
    rupee: Optional[float] = 0.0
    rate: float = 1.0
    paymenttype: str
    store: str
    producttype: str
    product: str
    quantity: float
    metric: str
    description: Optional[str] = None
    paidby: str
    paidfor: str
    splitwith: str
    pplsplit: int

class ExpenseCreate(ExpenseBase):
    pass

class ExpenseResponse(ExpenseBase):
    id: int
    
    class Config:
        orm_mode = True

# For Analytics
class SplitBalance(BaseModel):
    person: str
    balance: float # Positive = owed to them, Negative = they owe