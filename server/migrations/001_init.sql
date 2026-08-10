-- 001_init.sql
-- Schema: Książkomat (MariaDB, utf8mb4)

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS books (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  isbn VARCHAR(20) NULL,
  title VARCHAR(512) NOT NULL,
  author VARCHAR(512) NOT NULL,
  author_key VARCHAR(128) NULL,
  work_key VARCHAR(128) NULL,
  publisher VARCHAR(512) NULL,
  publish_year SMALLINT UNSIGNED NULL,
  cover_url VARCHAR(1024) NULL,
  edition VARCHAR(255) NULL,
  notes TEXT NULL,
  status ENUM('owned','wanted','loaned','read') NOT NULL DEFAULT 'owned',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_books_user (user_id),
  KEY idx_books_user_isbn (user_id, isbn),
  KEY idx_books_author_key (author_key),
  KEY idx_books_work_key (work_key),
  CONSTRAINT fk_books_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_events (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  book_id INT UNSIGNED NULL,
  kind ENUM('missing_book','new_edition') NOT NULL,
  payload JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  seen TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_notif_user (user_id, seen),
  KEY idx_notif_book (book_id),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_book FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ol_cache (
  `key` VARCHAR(255) NOT NULL,
  data MEDIUMTEXT NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
