import { useState } from 'react';
import type { Lang, Provider } from '../../types';
import StepWelcome from './StepWelcome';
import StepProvider from './StepProvider';
import StepApiKey from './StepApiKey';
import './Onboarding.css';

type Step = 0 | 1 | 2;

interface OnboardingProps {
  lang: Lang;
  onLangChange: (l: Lang) => void;
  /** Called once the user has saved a valid config. */
  onComplete: () => void;
}

export default function Onboarding({
  lang,
  onLangChange,
  onComplete,
}: OnboardingProps) {
  const [step, setStep] = useState<Step>(0);
  const [provider, setProvider] = useState<Provider>('openai');

  const progress = ((step + 1) / 3) * 100;

  return (
    <div className="onb-root reveal">
      <div className="onb-progress" aria-hidden>
        <div className="onb-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="onb-progress-label">
        <span className="mono faint">{String(step + 1).padStart(2, '0')} / 03</span>
      </div>

      <div className="onb-content">
        {step === 0 && (
          <StepWelcome
            lang={lang}
            onLangChange={onLangChange}
            onNext={() => setStep(1)}
          />
        )}
        {step === 1 && (
          <StepProvider
            lang={lang}
            selected={provider}
            onSelect={setProvider}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <StepApiKey
            lang={lang}
            provider={provider}
            onBack={() => setStep(1)}
            onComplete={onComplete}
          />
        )}
      </div>
    </div>
  );
}
