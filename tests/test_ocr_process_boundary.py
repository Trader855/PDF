import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import main


class OcrProcessBoundaryTests(unittest.TestCase):
    def test_helper_never_inherits_the_electron_lifecycle_pipe(self):
        result = subprocess.CompletedProcess([], 0, stdout='[]', stderr='')
        with patch.object(main, 'ocr_helper_command', return_value=['synthetic-ocr']), \
             patch.object(main.subprocess, 'run', return_value=result) as run:
            self.assertEqual(main.run_ocr_helper(Path('synthetic-helper'), Path('synthetic.png')), [])
        self.assertEqual(run.call_args.kwargs['stdin'], subprocess.DEVNULL)
        self.assertEqual(run.call_args.kwargs['timeout'], 20)
        self.assertTrue(run.call_args.kwargs['capture_output'])

    def test_windows_helper_stays_hidden_with_disconnected_stdin(self):
        result = subprocess.CompletedProcess([], 0, stdout='[]', stderr='')
        with patch.object(main.sys, 'platform', 'win32'), \
             patch.object(main, 'ocr_helper_command', return_value=['synthetic-powershell']), \
             patch.object(main.subprocess, 'run', return_value=result) as run:
            main.run_ocr_helper(Path('synthetic.ps1'), Path('synthetic.png'))
        self.assertEqual(run.call_args.kwargs['stdin'], subprocess.DEVNULL)
        self.assertIn('creationflags', run.call_args.kwargs)


if __name__ == '__main__':
    unittest.main()
