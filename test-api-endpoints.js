/**
 * 测试脚本：测试三个新的API端点
 * 使用PID 132626980进行测试
 */

const https = require('https');
const http = require('http');

// 配置测试参数
const TEST_PID = '132626980';
const BASE_URL = 'https://pixiv.chaosyn.com'; // 根据实际部署地址调整

/**
 * 发送HTTP请求的通用函数
 * @param {string} url - 请求URL
 * @param {string} method - HTTP方法
 * @param {object} data - 请求数据（POST请求时使用）
 * @returns {Promise} 返回响应数据
 */
function makeRequest(url, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Test-Script/1.0'
            }
        };

        if (data && method === 'POST') {
            const postData = JSON.stringify(data);
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const client = urlObj.protocol === 'https:' ? https : http;
        const req = client.request(options, (res) => {
            let responseData = '';
            
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(responseData);
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: jsonData
                    });
                } catch (error) {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: responseData
                    });
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        if (data && method === 'POST') {
            req.write(JSON.stringify(data));
        }
        
        req.end();
    });
}

/**
 * 测试获取插画推荐PID接口
 * @param {string} pid - 插画PID
 */
async function testGetIllustRecommendPids(pid) {
    console.log('\n=== 测试 /api/get-illust-recommend-pids 接口 ===');
    console.log(`测试PID: ${pid}`);
    
    try {
        const url = `${BASE_URL}/api?action=illust-recommend-pids&pid=${pid}`;
        console.log(`请求URL: ${url}`);
        
        const startTime = Date.now();
        const response = await makeRequest(url);
        const endTime = Date.now();
        
        console.log(`响应状态码: ${response.statusCode}`);
        console.log(`响应时间: ${endTime - startTime}ms`);
        console.log('响应数据:');
        console.log(JSON.stringify(response.data, null, 2));
        
        if (response.statusCode === 200 && response.data.pids) {
            console.log('✅ 接口测试成功');
            if (response.data.pids && response.data.pids.length > 0) {
                console.log(`📊 获取到 ${response.data.pids.length} 个推荐PID`);
            } else {
                console.log('📊 未获取到推荐PID');
            }
        } else {
            console.log('❌ 接口测试失败');
        }
    } catch (error) {
        console.error('❌ 请求失败:', error.message);
    }
}

/**
 * 测试获取作者推荐PID接口
 * @param {string} pid - 插画PID
 */
async function testGetAuthorRecommendPids(pid) {
    console.log('\n=== 测试 /api/get-author-recommend-pids 接口 ===');
    console.log(`测试PID: ${pid}`);
    
    try {
        const url = `${BASE_URL}/api?action=author-recommend-pids&pid=${pid}`;
        console.log(`请求URL: ${url}`);
        
        const startTime = Date.now();
        const response = await makeRequest(url);
        const endTime = Date.now();
        
        console.log(`响应状态码: ${response.statusCode}`);
        console.log(`响应时间: ${endTime - startTime}ms`);
        console.log('响应数据:');
        console.log(JSON.stringify(response.data, null, 2));
        
        if (response.statusCode === 200 && response.data.pids !== undefined) {
            console.log('✅ 接口测试成功');
            if (response.data.pids && response.data.pids.length > 0) {
                console.log(`📊 获取到 ${response.data.pids.length} 个作者推荐PID`);
            } else {
                console.log('📊 未获取到作者推荐PID');
            }
        } else {
            console.log('❌ 接口测试失败');
        }
    } catch (error) {
        console.error('❌ 请求失败:', error.message);
    }
}

/**
 * 测试获取PID详细信息接口
 * @param {string} pid - 插画PID
 */
async function testGetPidDetailInfo(pid) {
    console.log('\n=== 测试 /api/get-pid-detail-info 接口 ===');
    console.log(`测试PID: ${pid}`);
    
    try {
        const url = `${BASE_URL}/api?action=pid-detail-info&pid=${pid}`;
        console.log(`请求URL: ${url}`);
        
        const startTime = Date.now();
        const response = await makeRequest(url);
        const endTime = Date.now();
        
        console.log(`响应状态码: ${response.statusCode}`);
        console.log(`响应时间: ${endTime - startTime}ms`);
        console.log('响应数据:');
        console.log(JSON.stringify(response.data, null, 2));
        
        if (response.statusCode === 200) {
            if (response.data.success === false) {
                console.log('⚠️ 接口返回成功但获取详细信息失败');
                console.log(`原因: ${response.data.message}`);
            } else if (response.data.data) {
                console.log('✅ 接口测试成功');
                console.log(`📊 获取到PID详细信息`);
                console.log(`标题: ${response.data.data.title || 'N/A'}`);
                console.log(`作者: ${response.data.data.userName || 'N/A'}`);
                console.log(`点赞数: ${response.data.data.likeCount || 'N/A'}`);
                console.log(`收藏数: ${response.data.data.bookmarkCount || 'N/A'}`);
            } else {
                console.log('⚠️ 接口返回成功但数据为空');
            }
        } else {
            console.log('❌ 接口测试失败');
        }
    } catch (error) {
        console.error('❌ 请求失败:', error.message);
    }
}

/**
 * 运行所有测试
 */
async function runAllTests() {
    console.log('🚀 开始API端点测试');
    console.log(`测试目标: ${BASE_URL}`);
    console.log(`测试PID: ${TEST_PID}`);
    console.log('=' .repeat(50));
    
    try {
        // 测试三个API端点
        await testGetIllustRecommendPids(TEST_PID);
        await testGetAuthorRecommendPids(TEST_PID);
        await testGetPidDetailInfo(TEST_PID);
        
        console.log('\n' + '=' .repeat(50));
        console.log('🎉 所有测试完成');
        
    } catch (error) {
        console.error('❌ 测试过程中发生错误:', error.message);
    }
}

/**
 * 测试单个接口（可选）
 * @param {string} endpoint - 接口名称 ('illust', 'author', 'detail')
 * @param {string} pid - 测试PID
 */
async function testSingleEndpoint(endpoint, pid = TEST_PID) {
    console.log(`🎯 测试单个接口: ${endpoint}`);
    
    switch (endpoint.toLowerCase()) {
        case 'illust':
            await testGetIllustRecommendPids(pid);
            break;
        case 'author':
            await testGetAuthorRecommendPids(pid);
            break;
        case 'detail':
            await testGetPidDetailInfo(pid);
            break;
        default:
            console.error('❌ 未知的接口名称，支持的接口: illust, author, detail');
    }
}

// 主程序入口
if (require.main === module) {
    // 检查命令行参数
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        // 运行所有测试
        runAllTests();
    } else if (args.length === 1) {
        // 测试单个接口
        testSingleEndpoint(args[0]);
    } else if (args.length === 2) {
        // 测试单个接口，使用自定义PID
        testSingleEndpoint(args[0], args[1]);
    } else {
        console.log('使用方法:');
        console.log('  node test-api-endpoints.js                    # 运行所有测试');
        console.log('  node test-api-endpoints.js illust             # 测试插画推荐接口');
        console.log('  node test-api-endpoints.js author             # 测试作者推荐接口');
        console.log('  node test-api-endpoints.js detail             # 测试详细信息接口');
        console.log('  node test-api-endpoints.js illust 123456      # 使用自定义PID测试');
    }
}

// 导出函数供其他模块使用
module.exports = {
    testGetIllustRecommendPids,
    testGetAuthorRecommendPids,
    testGetPidDetailInfo,
    runAllTests,
    testSingleEndpoint
};