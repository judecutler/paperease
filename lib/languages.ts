import type { LangCode } from './types';
import type { SmsKind } from './llm';

// Message copy per language. English lives in lib/llm.ts (templateSms) and lib/wallet.ts; every other language is
// data in this file, so adding one means adding one entry here, a value in LangCode (types.ts), and widening the
// caregivers.language check in Supabase.
//
// Review status: Spanish was written with the original app. Tagalog, Vietnamese and Chinese are machine-drafted
// plain-language copy that has NOT been reviewed by a native speaker; `reviewed: false` shows a warning in the
// UI. Have a speaker of each language read them before texting real caregivers.

export type WalletKind = 'share-ask' | 'import-ask' | 'share-ok' | 'import-ok' | 'declined';
interface V { first: string; ask: string; field: string; doc: string }
interface W { f: string; agency: string }

export interface Pack {
  label: string;
  reviewed: boolean;
  /** what the agent asks for, per requirement id */
  ask: Record<string, string>;
  /** a missing field, as it appears inside a sentence */
  field: Record<string, string>;
  sms: Record<Exclude<SmsKind, never>, (v: V) => string>;
  wallet: Record<WalletKind, (v: W) => string>;
  /** extra words that mean yes / no / stop in this language (matched as a whole reply) */
  yes: string[];
  no: string[];
  stop: string[];
}

export const LANG_LABELS: Record<LangCode, string> = { en: 'English', es: 'Spanish', tl: 'Tagalog', vi: 'Vietnamese', zh: 'Chinese (Simplified)' };
export const LANG_CODES = Object.keys(LANG_LABELS) as LangCode[];
export const isLangCode = (x: unknown): x is LangCode => typeof x === 'string' && x in LANG_LABELS;

const es: Pack = {
  label: 'Spanish', reviewed: true,
  ask: {
    hca_registration: 'una foto de tu registro de Home Care Aide',
    tb_test: 'una foto de tu resultado más reciente de la prueba de TB',
    initial_training: 'tu certificado de capacitación inicial',
    annual_training: 'tu certificado de capacitación anual',
    background_check: 'tu verificación de antecedentes',
  },
  field: {
    hours: 'las horas de capacitación', completion_date: 'la fecha de finalización', course: 'el nombre del curso', expiration_date: 'la fecha de vencimiento',
    registration_number: 'el número de registro', test_date: 'la fecha de la prueba', result: 'el resultado', name: 'tu nombre',
  },
  sms: {
    request: ({ first, ask }) => `¡Hola ${first}! Tu agencia necesita ${ask}. ¿Puedes responder con una foto?`,
    'follow-up': ({ first, field }) => `¡Gracias, ${first}! No encontré ${field} en este documento. ¿Tienes otro documento que lo muestre? También puedes responder con el dato.`,
    thanks: ({ first }) => `¡Listo, gracias ${first}! La oficina lo revisará.`,
    escalated: ({ first }) => `¡Gracias, ${first}! Alguien de la oficina lo revisará y te contactará.`,
    'wrong-doc': ({ first, ask }) => `¡Gracias, ${first}! Esto parece ser otro documento. Necesitamos ${ask}. ¿Puedes enviarlo?`,
    reminder: ({ first, ask }) => `Hola ${first}, un recordatorio: tu agencia todavía necesita ${ask}. Responde con una foto cuando puedas.`,
    'request-another': ({ first, ask }) => `Hola ${first}, la oficina no pudo usar la imagen anterior. ¿Puedes enviar otra vez ${ask}, con una foto clara?`,
    'opted-out': () => 'Ya no recibirás mensajes de CareLoop. Tu agencia te contactará directamente.',
    approved: ({ first }) => `¡Gracias, ${first}! Tu documento fue aprobado. No necesitas hacer nada más.`,
    'passed-on': ({ first }) => `¡Gracias, ${first}! Se lo paso a la oficina.`,
  },
  wallet: {
    'share-ask': ({ f, agency }) => `¡Hola ${f}! ${agency} puede guardar tus registros verificados en tu cartera CareLoop para que otras agencias donde trabajes no te los pidan otra vez. Tú decides. Responde SI para permitirlo, o ignora este mensaje.`,
    'import-ask': ({ f, agency }) => `¡Hola ${f}! ${agency} encontró registros verificados en tu cartera CareLoop de otra agencia. Responde SI para que ${agency} los use (no tendrás que enviar fotos otra vez), o NO.`,
    'share-ok': ({ f, agency }) => `¡Listo, ${f}! Guardamos tus registros verificados. Puedes pedirle a ${agency} que los quite cuando quieras.`,
    'import-ok': ({ f, agency }) => `¡Gracias, ${f}! ${agency} usará esos registros y la oficina los confirmará.`,
    declined: ({ f }) => `De acuerdo, ${f}. No se compartirá nada.`,
  },
  yes: ['si', 'sí'], no: [], stop: ['alto', 'parar', 'detener', 'cancelar'],
};

const tl: Pack = {
  label: 'Tagalog', reviewed: false,
  ask: {
    hca_registration: 'larawan ng iyong Home Care Aide registration',
    tb_test: 'larawan ng pinakabagong resulta ng iyong TB test',
    initial_training: 'iyong certificate ng entry-level training',
    annual_training: 'iyong certificate ng taunang training',
    background_check: 'iyong background check clearance',
  },
  field: {
    hours: 'ang oras ng training', completion_date: 'ang petsa ng pagkumpleto', course: 'ang pangalan ng kurso', expiration_date: 'ang petsa ng pag-expire',
    registration_number: 'ang registration number', test_date: 'ang petsa ng test', result: 'ang resulta', name: 'ang iyong pangalan',
  },
  sms: {
    request: ({ first, ask }) => `Kumusta ${first}! Kailangan ng iyong ahensya ang ${ask}. Maaari ka bang sumagot ng larawan?`,
    'follow-up': ({ first, field }) => `Salamat, ${first}! Hindi ko makita ${field} sa dokumentong ito. May iba ka bang dokumento na nagpapakita nito? Maaari mo ring ibigay ito sa reply.`,
    thanks: ({ first }) => `Natanggap ko, salamat ${first}! Susuriin ito ng opisina.`,
    escalated: ({ first }) => `Salamat, ${first}! Titingnan ito ng isang tao sa opisina at makikipag-ugnayan sila sa iyo.`,
    'wrong-doc': ({ first, ask }) => `Salamat, ${first}! Mukhang ibang dokumento ito. Kailangan namin ang ${ask}. Maaari mo bang ipadala iyon?`,
    reminder: ({ first, ask }) => `Kumusta ${first}, paalala lang: kailangan pa rin ng iyong ahensya ang ${ask}. Sumagot ng larawan kapag may pagkakataon ka.`,
    'request-another': ({ first, ask }) => `Kumusta ${first}, hindi magamit ng opisina ang huling larawan. Maaari mo bang ipadala muli ang ${ask} bilang malinaw na larawan?`,
    'opted-out': () => 'Hindi ka na makakatanggap ng mga text mula sa CareLoop. Direktang makikipag-ugnayan sa iyo ang iyong ahensya.',
    approved: ({ first }) => `Salamat, ${first}! Naaprubahan na ang iyong dokumento. Wala nang kailangang gawin.`,
    'passed-on': ({ first }) => `Salamat, ${first}! Ipapasa ko ito sa opisina.`,
  },
  wallet: {
    'share-ask': ({ f, agency }) => `Kumusta ${f}! Maaaring i-save ng ${agency} ang iyong na-verify na mga record sa iyong CareLoop wallet para hindi na ito hingin ng ibang ahensya. Ikaw ang magpapasya. Sumagot ng OO para payagan, o huwag pansinin ito.`,
    'import-ask': ({ f, agency }) => `Kumusta ${f}! May nakita ang ${agency} na na-verify na mga record sa iyong CareLoop wallet mula sa ibang ahensya. Sumagot ng OO para magamit ito ng ${agency} (hindi mo na kailangang magpadala ng larawan), o HINDI.`,
    'share-ok': ({ f, agency }) => `Tapos na, ${f}! Naka-save na ang iyong na-verify na mga record. Maaari mong hilingin sa ${agency} na alisin ang mga ito anumang oras.`,
    'import-ok': ({ f, agency }) => `Salamat, ${f}! Gagamitin ng ${agency} ang mga record na iyon at kukumpirmahin ito ng opisina.`,
    declined: ({ f }) => `Walang problema, ${f}. Walang ibabahagi.`,
  },
  yes: ['oo', 'opo'], no: ['hindi', 'hindi po'], stop: ['tigil', 'itigil'],
};

const vi: Pack = {
  label: 'Vietnamese', reviewed: false,
  ask: {
    hca_registration: 'ảnh giấy đăng ký Home Care Aide của bạn',
    tb_test: 'ảnh kết quả xét nghiệm lao (TB) mới nhất của bạn',
    initial_training: 'chứng nhận đào tạo ban đầu của bạn',
    annual_training: 'chứng nhận đào tạo hằng năm của bạn',
    background_check: 'giấy xác nhận kiểm tra lý lịch của bạn',
  },
  field: {
    hours: 'số giờ đào tạo', completion_date: 'ngày hoàn thành', course: 'tên khóa học', expiration_date: 'ngày hết hạn',
    registration_number: 'số đăng ký', test_date: 'ngày xét nghiệm', result: 'kết quả', name: 'tên của bạn',
  },
  sms: {
    request: ({ first, ask }) => `Xin chào ${first}! Công ty của bạn cần ${ask}. Bạn có thể trả lời kèm một bức ảnh không?`,
    'follow-up': ({ first, field }) => `Cảm ơn ${first}! Tôi không thấy ${field} trên tài liệu này. Bạn có tài liệu khác thể hiện thông tin đó không? Bạn cũng có thể trả lời trực tiếp bằng tin nhắn.`,
    thanks: ({ first }) => `Đã nhận, cảm ơn ${first}! Văn phòng sẽ xem xét.`,
    escalated: ({ first }) => `Cảm ơn ${first}! Một nhân viên văn phòng sẽ xem và liên hệ lại với bạn.`,
    'wrong-doc': ({ first, ask }) => `Cảm ơn ${first}! Đây có vẻ là một loại giấy tờ khác. Chúng tôi cần ${ask}. Bạn có thể gửi giúp không?`,
    reminder: ({ first, ask }) => `Xin chào ${first}, nhắc nhẹ: công ty của bạn vẫn cần ${ask}. Hãy trả lời kèm ảnh khi bạn tiện.`,
    'request-another': ({ first, ask }) => `Xin chào ${first}, văn phòng không dùng được ảnh trước. Bạn có thể gửi lại ${ask} bằng một ảnh rõ nét không?`,
    'opted-out': () => 'Bạn sẽ không nhận tin nhắn CareLoop nữa. Công ty của bạn sẽ liên hệ trực tiếp.',
    approved: ({ first }) => `Cảm ơn ${first}! Tài liệu của bạn đã được duyệt. Bạn không cần làm gì thêm.`,
    'passed-on': ({ first }) => `Cảm ơn ${first}! Tôi sẽ chuyển việc này cho văn phòng.`,
  },
  wallet: {
    'share-ask': ({ f, agency }) => `Xin chào ${f}! ${agency} có thể lưu các hồ sơ đã xác minh của bạn vào ví CareLoop để các công ty khác bạn làm việc không hỏi lại. Bạn quyết định. Trả lời CÓ để cho phép, hoặc bỏ qua tin nhắn này.`,
    'import-ask': ({ f, agency }) => `Xin chào ${f}! ${agency} tìm thấy hồ sơ đã xác minh trong ví CareLoop của bạn từ một công ty khác. Trả lời CÓ để ${agency} sử dụng (bạn không cần gửi lại ảnh), hoặc KHÔNG.`,
    'share-ok': ({ f, agency }) => `Xong rồi, ${f}! Hồ sơ đã xác minh của bạn đã được lưu. Bạn có thể nhờ ${agency} xóa bất cứ lúc nào.`,
    'import-ok': ({ f, agency }) => `Cảm ơn ${f}! ${agency} sẽ dùng các hồ sơ đó và văn phòng sẽ xác nhận.`,
    declined: ({ f }) => `Không sao, ${f}. Sẽ không chia sẻ gì cả.`,
  },
  yes: ['có', 'vâng', 'dạ'], no: ['không', 'khong'], stop: ['dừng', 'dung'],
};

const zh: Pack = {
  label: 'Chinese (Simplified)', reviewed: false,
  ask: {
    hca_registration: '您的居家护理员（Home Care Aide）注册证照片',
    tb_test: '您最新的结核病（TB）检测结果照片',
    initial_training: '您的入职培训证书',
    annual_training: '您的年度培训证书',
    background_check: '您的背景调查许可',
  },
  field: {
    hours: '培训时数', completion_date: '完成日期', course: '课程名称', expiration_date: '到期日期',
    registration_number: '注册号码', test_date: '检测日期', result: '结果', name: '您的姓名',
  },
  sms: {
    request: ({ first, ask }) => `${first}您好！您的机构需要${ask}。请回复一张照片，好吗？`,
    'follow-up': ({ first, field }) => `谢谢，${first}！我在这份文件上没有找到${field}。您有其他显示这项信息的文件吗？您也可以直接回复短信告诉我。`,
    thanks: ({ first }) => `收到了，谢谢${first}！办公室会进行审核。`,
    escalated: ({ first }) => `谢谢，${first}！办公室的同事会查看并与您联系。`,
    'wrong-doc': ({ first, ask }) => `谢谢，${first}！这看起来是另一种文件。我们需要${ask}。可以请您发送吗？`,
    reminder: ({ first, ask }) => `${first}您好，温馨提醒：您的机构仍需要${ask}。方便时请回复照片。`,
    'request-another': ({ first, ask }) => `${first}您好，办公室无法使用上一张照片。请重新发送${ask}，并确保照片清晰。`,
    'opted-out': () => '您将不再收到 CareLoop 的短信。您的机构会直接与您联系。',
    approved: ({ first }) => `谢谢，${first}！您的文件已通过审核，无需再做任何事。`,
    'passed-on': ({ first }) => `谢谢，${first}！我会把这件事转给办公室。`,
  },
  wallet: {
    'share-ask': ({ f, agency }) => `${f}您好！${agency}可以把您已核实的记录保存到 CareLoop 钱包，这样您工作过的其他机构就不必再次索取。由您决定。回复“是”表示同意，或忽略此消息。`,
    'import-ask': ({ f, agency }) => `${f}您好！${agency}在您的 CareLoop 钱包中发现了另一家机构的已核实记录。回复“是”允许${agency}使用（无需重新发送照片），或回复“否”。`,
    'share-ok': ({ f, agency }) => `好了，${f}！您的已核实记录已保存。您可以随时请${agency}将其删除。`,
    'import-ok': ({ f, agency }) => `谢谢，${f}！${agency}将使用这些记录，办公室会进行确认。`,
    declined: ({ f }) => `没问题，${f}。不会分享任何内容。`,
  },
  yes: ['是', '好', '同意', '可以'], no: ['否', '不', '不要'], stop: ['停止', '退订', '取消'],
};

export const PACKS: Partial<Record<LangCode, Pack>> = { es, tl, vi, zh };

export const packFor = (lang: LangCode): Pack | undefined => PACKS[lang];
export const languageLabel = (lang: LangCode) => LANG_LABELS[lang] ?? 'English';

const allWords = (pick: (p: Pack) => string[]) => Object.values(PACKS).flatMap((p) => pick(p!));
export const extraYes = () => allWords((p) => p.yes);
export const extraNo = () => allWords((p) => p.no);
export const extraStop = () => allWords((p) => p.stop);
