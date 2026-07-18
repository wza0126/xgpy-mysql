export function formatDateTime(dateString: string | Date): string {
  const date = typeof dateString === 'string' ? parseDate(dateString) : dateString;
  if (isNaN(date.getTime())) {
    return '-';
  }
  const result = date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  console.log('[formatDateTime]', { input: dateString, parsedDate: date, result });
  return result;
}

export function formatDate(dateString: string | Date): string {
  const date = typeof dateString === 'string' ? parseDate(dateString) : dateString;
  if (isNaN(date.getTime())) {
    return '-';
  }
  const result = date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  console.log('[formatDate]', { input: dateString, parsedDate: date, result });
  return result;
}

export function formatTime(dateString: string | Date): string {
  const date = typeof dateString === 'string' ? parseDate(dateString) : dateString;
  if (isNaN(date.getTime())) {
    return '-';
  }
  const result = date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  console.log('[formatTime]', { input: dateString, parsedDate: date, result });
  return result;
}

export function parseDate(dateString: string): Date {
  console.log('[parseDate] 开始解析', { 
    dateString, 
    typeof: typeof dateString,
    isString: typeof dateString === 'string'
  });
  
  if (!dateString) {
    console.log('[parseDate] 空字符串');
    return new Date('invalid');
  }
  
  const trimmed = dateString.trim();
  
  const isoZRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
  const isoOffsetRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?[+-]\d{2}:\d{2}$/;
  const mysqlRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;
  
  let result: Date;
  
  if (isoZRegex.test(trimmed)) {
    console.log('[parseDate] 匹配 ISO Z 格式');
    result = new Date(trimmed);
  } else if (isoOffsetRegex.test(trimmed)) {
    console.log('[parseDate] 匹配 ISO Offset 格式');
    result = new Date(trimmed);
  } else if (mysqlRegex.test(trimmed)) {
    console.log('[parseDate] 匹配 MySQL 格式 - 直接解析成本地时间');
    const [datePart, timePart] = trimmed.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes, seconds] = timePart.split(':').map(Number);
    result = new Date(year, month - 1, day, hours, minutes, seconds);
    console.log('[parseDate] MySQL 转换', { 
      dateParts: { year, month, day, hours, minutes, seconds },
      resultDate: result
    });
  } else if (dateOnlyRegex.test(trimmed)) {
    console.log('[parseDate] 匹配 DateOnly 格式');
    const [year, month, day] = trimmed.split('-').map(Number);
    result = new Date(year, month - 1, day);
  } else {
    try {
      console.log('[parseDate] 使用默认解析');
      const date = new Date(trimmed);
      if (!isNaN(date.getTime())) {
        result = date;
      } else {
        result = new Date('invalid');
      }
    } catch {
      result = new Date('invalid');
    }
  }
  
  console.log('[parseDate] 最终结果', { 
    dateString, 
    trimmed, 
    resultDate: result,
    toLocaleString: result.toLocaleString('zh-CN')
  });
  return result;
}

export function toDatabaseDateTime(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const result = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  console.log('[toDatabaseDateTime]', { date, result });
  return result;
}

export function toISOString(date: Date): string {
  return date.toISOString();
}

export function getTodayStart(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

export function getTodayEnd(): Date {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return today;
}

export function getDaysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function isSameDay(date1: Date, date2: Date): boolean {
  return date1.toDateString() === date2.toDateString();
}

export function isBefore(date1: string | Date, date2: string | Date): boolean {
  const d1 = typeof date1 === 'string' ? parseDate(date1) : date1;
  const d2 = typeof date2 === 'string' ? parseDate(date2) : date2;
  return d1.getTime() < d2.getTime();
}

export function isAfter(date1: string | Date, date2: string | Date): boolean {
  const d1 = typeof date1 === 'string' ? parseDate(date1) : date1;
  const d2 = typeof date2 === 'string' ? parseDate(date2) : date2;
  return d1.getTime() > d2.getTime();
}

export function formatRelativeTime(dateString: string): string {
  const date = parseDate(dateString);
  if (isNaN(date.getTime())) {
    return '-';
  }
  
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  let result: string;
  if (minutes < 1) {
    result = '刚刚';
  } else if (minutes < 60) {
    result = `${minutes}分钟前`;
  } else if (hours < 24) {
    result = `${hours}小时前`;
  } else if (days < 7) {
    result = `${days}天前`;
  } else {
    result = formatDate(date);
  }
  
  return result;
}

export function compareDates(date1: string | Date, date2: string | Date): number {
  const d1 = typeof date1 === 'string' ? parseDate(date1) : date1;
  const d2 = typeof date2 === 'string' ? parseDate(date2) : date2;
  return d1.getTime() - d2.getTime();
}