import { useState, useMemo } from "react";
import { CallControls, SpeakerLayout } from "@stream-io/video-react-sdk";
import { Link } from "lucide-react";
import { useTRPC } from "@/trpc/clients";
import { useSuspenseQuery } from "@tanstack/react-query";

interface Props {
  onLeave: () => void;
  meetingId: string;
  meetingName: string;
}

export const CallActive = ({ onLeave, meetingId, meetingName }: Props) => {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(
    trpc.meetings.getOne.queryOptions({ id: meetingId })
  );

  const questions = useMemo(() => {
    const text = data.agent.lastResponse || "";
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("*") || line.startsWith("•") || line.startsWith("-"));

    return lines.map((line) =>
      line.replace(/^([*•\-])\s*/, "").replace(/^\"|\"$/g, "")
    );
  }, [data.agent.lastResponse]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const currentQuestion = questions[currentIndex];

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  return (
    <div className="flex flex-col justify-between h-full p-6 bg-gradient-to-b from-gray-900 to-black text-white">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-xl font-bold text-blue-400 hover:underline"
          >
            AI Interview Platform
          </Link>
          <h4 className="text-lg font-medium text-gray-300">{meetingName}</h4>
        </div>
      </div>

      {/* Main Layout */}
      <div className="flex-1 mt-6 flex flex-col items-center gap-6">
        <SpeakerLayout />

        {questions.length > 0 && (
          <div className="w-full max-w-3xl bg-gray-800 p-6 rounded-2xl shadow-lg text-white">
            <h3 className="text-xl font-semibold mb-3">
              Question {currentIndex + 1} of {questions.length}
            </h3>
            <p className="text-lg leading-relaxed text-gray-200">
              {currentQuestion}
            </p>
            <div className="flex justify-between items-center mt-6">
              <button
                onClick={handlePrevious}
                disabled={currentIndex === 0}
                className="px-4 py-2 rounded bg-gray-600 hover:bg-gray-700 disabled:opacity-50"
              >
                Previous
              </button>
              {currentIndex < questions.length - 1 ? (
                <button
                  onClick={handleNext}
                  className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700"
                >
                  Next
                </button>
              ) : (
                <p className="text-green-400">End of questions.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Call Controls */}
      <div className="mt-6">
        <CallControls onLeave={onLeave} />
      </div>
    </div>
  );
};
