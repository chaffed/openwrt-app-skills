#!/usr/bin/lua
--[[
    A stand-in for the GL.iNet admin panel's /rpc, for tests/gl.test.js.
    Installed in the test container as /www/cgi-bin/gl-rpc, it runs the
    real module (/usr/lib/oui-httpd/rpc/<object>) the way the panel does
    (firmware 4.10.1: /usr/share/gl-ngx/oui-rpc.lua and oui/rpc.lua):

    - arguments are checked first: unless /usr/share/gl-validator.d/<object>.lua
      says otherwise, every string must match the panel's default pattern;
    - the module gets the panel's own ngx.pipe: spawn(args, opts), then
      stdout_read_all() and wait(), nothing else. No input, no environment;
    - an empty table is sent as [] (the panel sets cjson up that way).

    Every command the module runs is written to /tmp/gl-rpc-spawn.log, so
    the test can prove a secret never was an argument.
--]]

local cjson = require "cjson"

local DEFAULT_PATTERN = '^[%w%. %-_:#/]-$'

local function reply(t)
    io.write("Content-Type: application/json\r\n\r\n", t, "\n")
end

-- JSON as the panel sends it: empty tables are arrays.
local function encode(v)
    if type(v) ~= "table" then return cjson.encode(v) end
    local n, count = #v, 0
    for _ in pairs(v) do count = count + 1 end
    if count == 0 then return "[]" end
    local parts = {}
    if n == count then
        for i = 1, n do parts[i] = encode(v[i]) end
        return "[" .. table.concat(parts, ",") .. "]"
    end
    for k, x in pairs(v) do parts[#parts + 1] = cjson.encode(tostring(k)) .. ":" .. encode(x) end
    return "{" .. table.concat(parts, ",") .. "}"
end

local function fail(id, code, message)
    reply(encode({ jsonrpc = "2.0", id = id or 0, error = { code = code, message = message } }))
    os.exit(0)
end

local function is_array(t)
    local i = 0
    for k in pairs(t) do
        i = i + 1
        if k ~= i then return false end
    end
    return i > 0
end

local function valid_args(args, validator, array)
    for k, v in pairs(args) do
        if not array and not tostring(k):match('^[%a_-][%w_-]-') then return false end
        if type(v) == "table" then
            local vt = type(validator) == "table" and validator[k] or nil
            if type(vt) == "function" then
                if not vt(v) then return false end
            elseif not valid_args(v, vt, is_array(v)) then
                return false
            end
        elseif type(v) == "string" then
            local vt = type(validator) == "table" and validator[k] or nil
            if type(vt) ~= "string" and type(vt) ~= "function" then vt = DEFAULT_PATTERN end
            local ok
            if type(vt) == "string" then ok = v:match(vt) else ok = vt(v) end
            if not ok then return false end
        elseif type(v) ~= "number" and type(v) ~= "boolean" then
            return false
        end
    end
    return true
end

local spawn_log = io.open("/tmp/gl-rpc-spawn.log", "a")

ngx = {
    ERR = 1, NOTICE = 2, DEBUG = 3,
    log = function() end,
    pipe = {
        spawn = function(args)
            if type(args) == "string" then args = { "sh", "-c", args } end
            local quoted = {}
            for i, a in ipairs(args) do
                quoted[i] = "'" .. (tostring(a):gsub("'", "'\\''")) .. "'"
            end
            spawn_log:write(table.concat(args, " "), "\n")
            spawn_log:flush()
            local p, data = io.popen(table.concat(quoted, " ") .. " 2>/dev/null", "r"), nil
            local function read_all()
                if not data then
                    data = p:read("*a") or ""
                    p:close()
                end
                return data
            end
            return setmetatable({ stdout_read_all = read_all, wait = read_all }, { __index = function(_, k)
                error("the panel's ngx.pipe has no method " .. tostring(k), 2)
            end })
        end,
    },
}

local body = io.read(tonumber(os.getenv("CONTENT_LENGTH") or "0") or 0) or ""
local ok, req = pcall(cjson.decode, body)
if not ok or type(req) ~= "table" then fail(nil, -32700, "Parse error") end
if req.method ~= "call" or type(req.params) ~= "table" or #req.params < 3 then fail(req.id, -32602, "Invalid params") end

local object, method, args = req.params[2], req.params[3], req.params[4]
if type(object) ~= "string" or type(method) ~= "string"
    or not object:match('^[%a_][%w%-_]+$') or not method:match('^[%a_][%w%-_]+$')
    or (args ~= nil and type(args) ~= "table") then
    fail(req.id, -32602, "Invalid params")
end
args = args or {}

local validator
local vf = io.open("/usr/share/gl-validator.d/" .. object .. ".lua", "r")
if vf then
    vf:close()
    validator = dofile("/usr/share/gl-validator.d/" .. object .. ".lua")
end
if type(validator) == "table" then validator = validator[method] end
if validator ~= true and not valid_args(args, type(validator) == "table" and validator or nil, false) then
    fail(req.id, -32602, "Invalid params")
end

local loaded, module = pcall(dofile, "/usr/lib/oui-httpd/rpc/" .. object)
if not loaded or type(module) ~= "table" or type(module[method]) ~= "function" then
    fail(req.id, -32601, "Method not found")
end

local res = module[method](args)
if type(res) == "number" then fail(req.id, res, "Unknown") end
if type(res) ~= "table" then res = {} end
reply('{"jsonrpc":"2.0","id":' .. cjson.encode(req.id or 0) .. ',"result":' .. encode(res) .. '}')
