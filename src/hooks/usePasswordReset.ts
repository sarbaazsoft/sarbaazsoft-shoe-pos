import { useState, useCallback } from 'react';
import { api } from '../services/api.ts';
import { useResendCooldown } from './useResendCooldown.ts';

export type PasswordResetStep = 'request' | 'verify' | 'confirm';
export type PasswordResetRoleScope = 'ALL' | 'STORE' | 'SUPERADMIN';

export interface UsePasswordResetOptions {
  email: string;
  onEmailChange: (nextEmail: string) => void;
  tenantId?: number | null;
  roleScope?: PasswordResetRoleScope;
  enabled: boolean;
  onResetSuccess: (message: string, resetEmail: string) => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function usePasswordReset({
  email,
  onEmailChange,
  tenantId,
  roleScope = 'ALL',
  enabled,
  onResetSuccess,
}: UsePasswordResetOptions) {
  const [step, setStep] = useState<PasswordResetStep>('request');
  const [code, setCodeState] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [pasteBlocked, setPasteBlocked] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  const trimmedEmail = email.trim();
  const isEmailValid = EMAIL_REGEX.test(trimmedEmail);
  const showEmailError =
    (emailTouched || trimmedEmail.length > 0) && trimmedEmail.length > 0 && !isEmailValid;

  const cooldown = useResendCooldown({
    flow: 'password_reset',
    email: trimmedEmail,
    enabled,
  });

  const setCode = useCallback((rawValue: string) => {
    const digitsOnly = String(rawValue || '').replace(/\D/g, '').slice(0, 6);
    setCodeState(digitsOnly);
  }, []);

  const triggerPasteBlockedNotice = useCallback(() => {
    setPasteBlocked(true);
    setTimeout(() => setPasteBlocked(false), 3500);
  }, []);

  const resetFlow = useCallback((nextStep: PasswordResetStep = 'request') => {
    setStep(nextStep);
    setCodeState('');
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setPasteBlocked(false);
    setEmailTouched(false);
    setErrorMessage(null);
    setInfoMessage(null);
    setResendSuccess(null);
    setResendError(null);
  }, []);

  const updateEmail = useCallback(
    (nextEmail: string) => {
      onEmailChange(nextEmail);
      if (errorMessage) setErrorMessage(null);
    },
    [errorMessage, onEmailChange]
  );

  const requestCode = useCallback(async () => {
    setEmailTouched(true);
    if (!isEmailValid) {
      setErrorMessage('Please enter a valid email address before requesting a 6-digit verification code.');
      return false;
    }
    if (cooldown.isInCooldown) {
      setErrorMessage(
        `Please wait ${cooldown.formattedCountdown} before requesting another password reset code.`
      );
      return false;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setInfoMessage(null);
    setResendSuccess(null);
    setResendError(null);

    try {
      const res = await api.auth.requestPasswordResetCode({
        email: trimmedEmail,
        tenantId: roleScope === 'SUPERADMIN' ? undefined : tenantId,
        roleScope,
        isResend: false,
      });
      if (res.cooldown) {
        cooldown.applyServerCooldown(res.cooldown);
      }
      setCodeState('');
      setNewPassword('');
      setConfirmPassword('');
      setInfoMessage(
        res.message ||
          `A 6-digit verification code has been sent to ${trimmedEmail}. Please check your Inbox (or Spam/Junk folder) and enter it below.`
      );
      setStep('verify');
      return true;
    } catch (err: any) {
      if (err?.status === 429 || typeof err?.remainingSeconds === 'number') {
        cooldown.applyServerCooldown(err);
      }
      setErrorMessage(err?.message || 'Failed to send 6-digit password reset code.');
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [cooldown, isEmailValid, roleScope, tenantId, trimmedEmail]);

  const resendCode = useCallback(async () => {
    if (!isEmailValid) {
      setResendError('Please enter a valid account email address before resending the reset code.');
      return false;
    }
    if (cooldown.isInCooldown || isResending) return false;

    setIsResending(true);
    setResendError(null);
    setResendSuccess(null);
    setErrorMessage(null);

    try {
      const res = await api.auth.requestPasswordResetCode({
        email: trimmedEmail,
        tenantId: roleScope === 'SUPERADMIN' ? undefined : tenantId,
        roleScope,
        isResend: true,
      });
      if (res.cooldown) {
        cooldown.applyServerCooldown(res.cooldown);
      }
      setCodeState('');
      setResendSuccess(
        res.message ||
          `A fresh 6-digit verification code has been sent to ${trimmedEmail}. Please check your Inbox or Spam/Junk folder.`
      );
      return true;
    } catch (err: any) {
      if (err?.status === 429 || typeof err?.remainingSeconds === 'number') {
        cooldown.applyServerCooldown(err);
      }
      setResendError(err?.message || 'Failed to resend reset code. Please try again later.');
      return false;
    } finally {
      setIsResending(false);
    }
  }, [cooldown, isEmailValid, isResending, roleScope, tenantId, trimmedEmail]);

  const verifyCode = useCallback(async () => {
    if (!isEmailValid) {
      setErrorMessage('Please enter a valid email address.');
      return false;
    }
    if (!/^\d{6}$/.test(code)) {
      setErrorMessage('Please enter the 6-digit numeric verification code sent to your email.');
      return false;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setInfoMessage(null);
    setResendError(null);
    setResendSuccess(null);

    try {
      const res = await api.auth.verifyPasswordResetCode({
        email: trimmedEmail,
        code,
        tenantId: roleScope === 'SUPERADMIN' ? undefined : tenantId,
        roleScope,
      });
      setInfoMessage(
        res?.message || 'Verification code confirmed. Enter your new password below.'
      );
      setStep('confirm');
      return true;
    } catch (err: any) {
      setErrorMessage(err?.message || 'Invalid or expired 6-digit verification code.');
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [code, isEmailValid, roleScope, tenantId, trimmedEmail]);

  const confirmReset = useCallback(async () => {
    if (!isEmailValid) {
      setErrorMessage('Please enter a valid email address.');
      return false;
    }
    if (!/^\d{6}$/.test(code)) {
      setErrorMessage('Verification code must be 6 digits. Please re-enter or request a new code.');
      setStep('verify');
      return false;
    }
    if (newPassword.length < 6) {
      setErrorMessage('New password must be at least 6 characters long.');
      return false;
    }
    if (confirmPassword !== newPassword) {
      setErrorMessage('Passwords do not match. Please enter the same password twice.');
      return false;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      const res = await api.auth.confirmPasswordReset({
        email: trimmedEmail,
        code,
        newPassword,
        confirmPassword,
        tenantId: roleScope === 'SUPERADMIN' ? undefined : tenantId,
        roleScope,
      });
      cooldown.clearCooldown();
      const successMsg =
        res?.message ||
        'Password has been reset successfully! You can now sign in with your new password.';
      const completedEmail = trimmedEmail;
      resetFlow('request');
      onResetSuccess(successMsg, completedEmail);
      return true;
    } catch (err: any) {
      const errCode = String(err?.code || '');
      setErrorMessage(err?.message || 'Failed to update password.');
      if (
        errCode === 'VERIFICATION_CODE_EXPIRED' ||
        errCode === 'VERIFICATION_ATTEMPTS_EXCEEDED' ||
        errCode === 'INVALID_VERIFICATION_CODE' ||
        errCode === 'INVALID_OR_EXPIRED_CODE'
      ) {
        setStep('verify');
      }
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [
    code,
    confirmPassword,
    cooldown,
    isEmailValid,
    newPassword,
    onResetSuccess,
    resetFlow,
    roleScope,
    tenantId,
    trimmedEmail,
  ]);

  return {
    step,
    setStep,
    email,
    trimmedEmail,
    updateEmail,
    isEmailValid,
    showEmailError,
    setEmailTouched,
    code,
    setCode,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    showNewPassword,
    setShowNewPassword,
    showConfirmPassword,
    setShowConfirmPassword,
    pasteBlocked,
    setPasteBlocked,
    triggerPasteBlockedNotice,
    isSubmitting,
    isResending,
    errorMessage,
    setErrorMessage,
    infoMessage,
    setInfoMessage,
    resendSuccess,
    resendError,
    cooldown,
    requestCode,
    verifyCode,
    confirmReset,
    resendCode,
    resetFlow,
  };
}

export type PasswordResetController = ReturnType<typeof usePasswordReset>;
