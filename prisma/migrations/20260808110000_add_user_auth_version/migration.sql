-- 用户认证版本：密码、账号状态或角色发生安全相关变更时递增。
-- JWT 携带签发时版本，服务端比对后可使既有 Access/Refresh Token 立即失效。
ALTER TABLE "users" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;

-- 在数据库层保证所有安全相关的用户更新均原子地废止旧 Token，
-- 包括未来绕过 UserService 的维护脚本或后台任务。
CREATE OR REPLACE FUNCTION "bump_user_auth_version"() RETURNS trigger AS $$
BEGIN
  IF NEW."password" IS DISTINCT FROM OLD."password"
    OR NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."role" IS DISTINCT FROM OLD."role"
  THEN
    NEW."authVersion" := OLD."authVersion" + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_bump_auth_version"
BEFORE UPDATE OF "password", "status", "role" ON "users"
FOR EACH ROW EXECUTE FUNCTION "bump_user_auth_version"();
