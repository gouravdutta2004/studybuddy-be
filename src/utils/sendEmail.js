const { Resend } = require('resend');

const sendEmail = async (options) => {
  try {
    if (process.env.NODE_ENV !== 'production' && !process.env.RESEND_API_KEY) {
      console.log(`\n=== 📧 MOCK EMAIL DISPATCHED ===`);
      console.log(`TO:      ${options.email}`);
      console.log(`SUBJECT: ${options.subject}`);
      console.log(`--------------------------------`);
      if (options.resetUrl) {
        console.log(`PASSWORD RESET URL:`);
        console.log(`${options.resetUrl}`);
      } else {
        console.log(options.message || options.html?.replace(/<[^>]*>?/gm, ''));
      }
      console.log(`================================\n`);
      return;
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const { data, error } = await resend.emails.send({
      from: `${process.env.FROM_NAME || 'StudyFriend'} <onboarding@resend.dev>`,
      to: [options.email],
      subject: options.subject,
      html: options.html || `<p>${options.message}</p>`,
    });

    if (error) {
       throw new Error(error.message);
    }
    
    return data;
  } catch (err) {
    console.error('Email dispatcher failed:', err.message);
    throw err;
  }
};

module.exports = sendEmail;
