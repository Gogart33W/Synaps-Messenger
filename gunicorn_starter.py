# gunicorn_starter.py
import eventlet
eventlet.monkey_patch()

# ===== МІГРАЦІЯ БД ПЕРЕД ЗАПУСКОМ =====
import os
from sqlalchemy import create_engine, inspect, text

def migrate_database():
    """Оновлює БД ДО запуску Flask"""
    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        print("❌ DATABASE_URL not found")
        return
    
    # Фікс для Render
    if database_url.startswith('postgres://'):
        database_url = database_url.replace('postgres://', 'postgresql://', 1)
    
    print("\n" + "="*60)
    print("🔧 DATABASE MIGRATION STARTING...")
    print("="*60)
    
    try:
        engine = create_engine(database_url)
        inspector = inspect(engine)
        
        with engine.connect() as conn:
            existing_tables = inspector.get_table_names()
            print(f"📋 Existing tables: {existing_tables}")
            
            # Оновлюємо user
            if 'user' in existing_tables:
                columns = [col['name'] for col in inspector.get_columns('user')]
                print(f"📋 User columns: {columns}")
                
                if 'display_name' not in columns:
                    print("➕ Adding display_name...")
                    conn.execute(text('ALTER TABLE "user" ADD COLUMN display_name VARCHAR(100)'))
                    conn.commit()
                
                if 'avatar_url' not in columns:
                    print("➕ Adding avatar_url...")
                    conn.execute(text('ALTER TABLE "user" ADD COLUMN avatar_url VARCHAR(512)'))
                    conn.commit()
                
                if 'bio' not in columns:
                    print("➕ Adding bio...")
                    conn.execute(text('ALTER TABLE "user" ADD COLUMN bio VARCHAR(500)'))
                    conn.commit()
                
                print("✅ User table updated")
            
            # Створюємо favorite
            if 'favorite' not in existing_tables:
                print("➕ Creating favorite table...")
                conn.execute(text('''
                    CREATE TABLE favorite (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL,
                        favorite_id INTEGER NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT fk_user FOREIGN KEY(user_id) REFERENCES "user"(id) ON DELETE CASCADE,
                        CONSTRAINT fk_favorite FOREIGN KEY(favorite_id) REFERENCES "user"(id) ON DELETE CASCADE,
                        CONSTRAINT unique_favorite UNIQUE(user_id, favorite_id)
                    )
                '''))
                conn.commit()
                print("✅ Favorite table created")
            
            print("="*60)
            print("✅ MIGRATION COMPLETED SUCCESSFULLY")
            print("="*60 + "\n")
            
    except Exception as e:
        print("="*60)
        print(f"❌ MIGRATION ERROR: {e}")
        print("="*60 + "\n")
        import traceback
        traceback.print_exc()

# ЗАПУСКАЄМО МІГРАЦІЮ ПЕРЕД ІМПОРТОМ APP
migrate_database()

# ТЕПЕР імпортуємо додаток
from app import create_app, socketio
app = create_app()

print("🚀 Application ready to start!")