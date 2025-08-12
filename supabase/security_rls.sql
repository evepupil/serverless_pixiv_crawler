-- ========================================
-- 安全 RLS 配置 - 限制 Publishable Key 只能读取
-- ========================================

-- 启用 RLS 保护
ALTER TABLE pic ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking ENABLE ROW LEVEL SECURITY;

-- 删除现有的宽松策略（如果存在）
DROP POLICY IF EXISTS "Allow public read access to pic" ON pic;
DROP POLICY IF EXISTS "Allow crawler insert to pic" ON pic;
DROP POLICY IF EXISTS "Allow crawler update to pic" ON pic;
DROP POLICY IF EXISTS "Deny all delete from pic" ON pic;

DROP POLICY IF EXISTS "Allow public read access to ranking" ON ranking;
DROP POLICY IF EXISTS "Allow crawler upsert to ranking" ON ranking;
DROP POLICY IF EXISTS "Allow crawler update to ranking" ON ranking;
DROP POLICY IF EXISTS "Deny all delete from ranking" ON ranking;

-- 创建安全策略：允许读取，Service Role可以写入
-- pic 表策略
CREATE POLICY "allow_read_pic" ON pic
    FOR SELECT USING (true);

CREATE POLICY "allow_service_role_write_pic" ON pic
    FOR ALL USING (
        auth.role() = 'service_role' OR 
        current_setting('role') = 'service_role' OR
        current_user = 'service_role'
    );

-- ranking 表策略  
CREATE POLICY "allow_read_ranking" ON ranking
    FOR SELECT USING (true);

CREATE POLICY "allow_service_role_write_ranking" ON ranking
    FOR ALL USING (
        auth.role() = 'service_role' OR 
        current_setting('role') = 'service_role' OR
        current_user = 'service_role'
    );

-- 撤销所有默认权限
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- 只授予读取权限
GRANT SELECT ON pic TO anon, authenticated;
GRANT SELECT ON ranking TO anon, authenticated;

-- 创建管理角色（用于内部爬虫操作）
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pixiv_admin') THEN
        CREATE ROLE pixiv_admin;
    END IF;
END$$;

-- 为管理角色授予所有权限（仅限内部使用）
GRANT ALL ON ALL TABLES IN SCHEMA public TO pixiv_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO pixiv_admin;

-- 创建安全状态检查视图
CREATE OR REPLACE VIEW security_status AS
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled,
    CASE 
        WHEN rowsecurity THEN '✅ 已启用'
        ELSE '❌ 未启用'
    END as rls_status
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- 创建权限概览视图
CREATE OR REPLACE VIEW role_permissions AS
SELECT 
    r.rolname as role_name,
    r.rolsuper as is_superuser,
    r.rolcreaterole as can_create_roles,
    r.rolcreatedb as can_create_databases,
    r.rolcanlogin as can_login
FROM pg_roles r
WHERE r.rolname IN ('anon', 'authenticated', 'pixiv_admin')
ORDER BY r.rolname;

-- 输出安全配置完成信息
DO $$
BEGIN
    RAISE NOTICE '🔒 严格安全配置完成！';
    RAISE NOTICE '✅ RLS 已启用';
    RAISE NOTICE '✅ 所有修改操作已禁止';
    RAISE NOTICE '✅ 只允许读取操作';
    RAISE NOTICE '⚠️  Publishable Key 现在只能读取数据';
    RAISE NOTICE '⚠️  爬虫操作需要使用 pixiv_admin 角色';
    RAISE NOTICE '⚠️  请使用 Secret Key 进行爬虫操作';
END$$;