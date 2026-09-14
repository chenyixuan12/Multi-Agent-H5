import pcCode from 'china-division/dist/pc-code.json'
import hkmoTw from 'china-division/dist/HK-MO-TW.json'

const MUNICIPALITIES = ['北京市', '天津市', '上海市', '重庆市']

// 港澳台数据是 { 地区: { 城市: [区县] } } 的对象结构，转为省级选项
const hkmoTwOptions = Object.keys(hkmoTw).map((provinceName) => ({
  text: provinceName,
  value: provinceName,
  children: Object.keys(hkmoTw[provinceName]).map((cityName) => ({
    text: cityName,
    value: `${provinceName}-${cityName}`,
  })),
}))

const normalize = (province) => {
  const cities = province.children || []
  // 直辖市的第二级是区县，这里收敛为“市”本身，保持省->市两级结构一致
  if (MUNICIPALITIES.includes(province.name) || cities.length === 0) {
    return [{ text: province.name, value: String(province.code) }]
  }
  return cities.map((city) => ({
    text: city.name,
    value: String(city.code),
  }))
}

export const provinceCityOptions = [
  ...pcCode.map((province) => ({
    text: province.name,
    value: String(province.code),
    children: normalize(province),
  })),
  ...hkmoTwOptions,
]
