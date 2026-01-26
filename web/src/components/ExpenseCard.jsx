import React from 'react';

const ExpenseCard = ({ expense }) => {
  const cardStyle = {
    backgroundColor: 'var(--bg-secondary)',
    padding: '1.5rem',
    borderRadius: '10px',
    boxShadow: 'var(--card-shadow)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem',
    borderLeft: `5px solid var(--accent-primary)`
  };

  return (
    <div style={cardStyle}>
      <div>
        <h3 style={{ margin: '0 0 0.5rem 0' }}>{expense.title}</h3>
        <small style={{ color: 'var(--text-secondary)' }}>{expense.date}</small>
      </div>
      <div style={{ textAlign: 'right' }}>
        <h2 style={{ margin: 0, color: 'var(--accent-secondary)' }}>
          ${expense.amount}
        </h2>
        <small style={{ color: 'var(--text-secondary)' }}>{expense.category}</small>
      </div>
    </div>
  );
};

export default ExpenseCard;