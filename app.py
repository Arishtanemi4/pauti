# app/main.py
from fastapi import FastAPI
from database import engine, Base
from routers import expenses, analytics

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Personal Expense Tracker Backend")

app.include_router(expenses.router)
app.include_router(analytics.router)

@app.get("/")
def read_root():
    return {"message": "Expense Tracker API is running"}