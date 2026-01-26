from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from ..database import get_db
from .. import models


router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/category-spend")
def get_category_spend(db: Session = Depends(get_db)):
    """
    Returns total spend grouped by Category Name.
    Joins: TransactionLine -> Product -> Category
    """
    results = db.query(
        models.Category.category_name,
        func.sum(models.TransactionLine.line_amount).label("total")
    ).join(models.Product, models.TransactionLine.product_id == models.Product.product_id)\
     .join(models.Category, models.Product.product_category_id == models.Category.category_id)\
     .group_by(models.Category.category_name).all()
    
    return [{"category": r[0], "total_amount": r[1]} for r in results]