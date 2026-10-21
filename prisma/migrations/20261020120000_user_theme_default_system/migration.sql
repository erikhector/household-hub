-- UX-51: a new account follows the device's light/dark setting until its owner
-- picks a theme. Existing rows keep the "dark" they were created with.
ALTER TABLE "User" ALTER COLUMN "theme" SET DEFAULT 'system';
