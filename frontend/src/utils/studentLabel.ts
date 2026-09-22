/**
 * 学生显示名：账号在前、姓名在后，合成一个字段（如「20230101 张三」）。
 *
 * 为什么合并：同名同姓的学生在表格里无法区分，教师此前只能靠猜；
 * 把账号（学号/登录名）并进同一格，既不新增列宽瓶颈，也能一眼对上人。
 *
 * 退化规则：缺账号只显示姓名，缺姓名只显示账号，都没有给 '-'。
 */

export type StudentNameLike = {
  username?: string | null;
  real_name?: string | null;
  [key: string]: any;
};

export const studentLabel = (s: StudentNameLike | null | undefined): string => {
  const account = String(s?.username ?? '').trim();
  const name = String(s?.real_name ?? '').trim();
  if (account && name) return `${account} ${name}`;
  return name || account || '-';
};
