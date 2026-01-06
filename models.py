# app/models.py
from sqlalchemy import Column, Integer, String, Float, Date, DateTime
from sqlalchemy.sql import func
from .database import Base

class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Core columns from your schema
    date = Column(Date, index=True)
    pound = Column(Float, nullable=True) # GBP
    rupee = Column(Float, nullable=True) # INR
    rate = Column(Float)                 # Conversion rate
    paymenttype = Column(String)         # cash, niyo, sbi, hsbc
    store = Column(String)
    producttype = Column(String)         # groceries, toiletries, etc.
    product = Column(String)             # Item name
    quantity = Column(Float)
    metric = Column(String)              # kg, ml, unit
    description = Column(String, nullable=True)
    
    # Splitting Logic Columns
    paidby = Column(String)              # Person who paid
    paidfor = Column(String)             # Beneficiary
    splitwith = Column(String)           # CSV string of names: "Alice,Bob"
    pplsplit = Column(Integer)           # Number of people splitting