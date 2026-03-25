#!/usr/bin/env python
"""Fix database schema by dropping and recreating tables."""
import sys
from app.db.database import Base, engine
from app.models.condition_preference import ConditionPreference, LogicPreference

def main():
    print("Dropping old tables...")
    # Drop in correct order due to foreign keys
    Base.metadata.drop_all(bind=engine, tables=[ConditionPreference.__table__, LogicPreference.__table__])
    print("✓ Dropped tables")
    
    print("Creating new tables with correct schema...")
    Base.metadata.create_all(bind=engine)
    print("✓ Created new tables")
    
    print("\nDatabase schema fixed! Restart the backend to use the new schema.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
